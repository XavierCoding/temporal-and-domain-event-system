/**
 * IntentJourney — pre-qualification workflow
 *
 * Flow:
 *   1. Referral received → trigger Samvadini call
 *   2. Wait for Samvadini response (samvadini_interested | not_interested)
 *      - not_interested  → assign TC to VL server → done
 *      - samvadini_interested → start OnboardingJourney as child → done
 *   3. Timeout (24h with no response) → assign TC to VL server → done
 */
import {
  condition,
  defineSignal,
  defineQuery,
  setHandler,
  proxyActivities,
  startChild,
  ParentClosePolicy,
  log,
} from "@temporalio/workflow";

import type * as AllActivities from "../activities/index.js";
import { DomainEvent } from "../schemas/domain-event.js";
import { hoursToMs } from "./helpers.js";

// ── Activity proxies ──────────────────────────────────────────────────────────

const acts = proxyActivities<typeof AllActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

const cleanupActs = proxyActivities<typeof AllActivities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 1 },
});

// ── Signals / Queries ─────────────────────────────────────────────────────────

export const intentEventSignal = defineSignal<[DomainEvent]>("domain_event");
export const intentStageQuery  = defineQuery<string>("currentStage");

// ── Workflow ──────────────────────────────────────────────────────────────────

export async function IntentJourney(phone: string, client: string): Promise<void> {
  const events: DomainEvent[] = [];
  let stage = "referral";

  setHandler(intentStageQuery, () => stage);
  setHandler(intentEventSignal, (event: DomainEvent) => {
    log.info("intent signal received", { phone, eventType: event.event_type });
    events.push(event);
  });

  const hasResponse = () =>
    events.some(
      (e) => e.event_type === "samvadini_interested" || e.event_type === "not_interested"
    );

  log.info("intent journey started", { phone, client });

  // ── Stage: referral ───────────────────────────────────────────────────────
  // Trigger Samvadini call immediately on referral
  stage = "referral";
  await acts.triggerSamvadiniCall({ phone, client });
  log.info("samvadini call triggered", { phone });

  // ── Stage: start_intent ───────────────────────────────────────────────────
  // Wait up to 24h for Samvadini response
  stage = "start_intent";
  log.info("waiting for samvadini response", { phone });

  const responded = await condition(hasResponse, hoursToMs(24));

  if (!responded) {
    log.info("no response in 24h — assigning TC", { phone });
    try { await cleanupActs.assignTcToVl({ phone }); } catch { /* best-effort */ }
    stage = "timed_out";
    return;
  }

  const outcome = events.find(
    (e) => e.event_type === "samvadini_interested" || e.event_type === "not_interested"
  );

  if (outcome?.event_type === "not_interested") {
    log.info("not interested — assigning TC to VL", { phone });
    try { await acts.assignTcToVl({ phone }); } catch { /* best-effort */ }
    stage = "not_interested";
    return;
  }

  // samvadini_interested → hand off to OnboardingJourney
  log.info("interested — starting onboarding journey", { phone, client });
  stage = "handing_off";

  try {
    await startChild("OnboardingJourney", {
      workflowId:            `journey-${phone}`,
      args:                  [phone, client],
      workflowIdReusePolicy: "ALLOW_DUPLICATE",
      parentClosePolicy:     ParentClosePolicy.ABANDON,
    });
  } catch (err: unknown) {
    // If an OnboardingJourney is already running for this phone, that's fine —
    // the rider is already in onboarding. Log and continue.
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("onboarding journey already running or could not start", { phone, error: msg });
  }

  stage = "completed";
  log.info("intent journey completed — onboarding started", { phone });
}
