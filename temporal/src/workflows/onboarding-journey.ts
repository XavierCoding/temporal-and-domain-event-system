/**
 * OnboardingJourney — Temporal workflow
 *
 * Drives a rider through multi-stage onboarding using a nudge ladder:
 * - Waits for domain events (signals) at each stage
 * - If no event arrives within `wait_hours`, sends a nudge (free-form or template
 *   based on WA window state) and advances to the next rung
 * - After the last rung times out, runs on_exhaust then marks give_up
 * - Handles TC assignment (pause all engagement) and restart_journey (resume)
 * - Respects quiet hours 21:00–08:00 IST before any nudge
 * - Checks live demand before O5 nudges
 */
import {
  condition,
  defineSignal,
  defineQuery,
  setHandler,
  proxyActivities,
  log,
} from "@temporalio/workflow";

import type * as AllActivities from "../activities/index.js";
import type {
  JourneyConfig,
  StageConfig,
  NudgeRung,
  ActionCfg,
  EventTransition,
} from "../activities/journey-activities.js";
import { DomainEvent, EventType } from "../schemas/domain-event.js";
import { ActionArgs } from "../schemas/action-args.js";
import { sleepWithQuietHours, hoursToMs, minutesToMs } from "./helpers.js";

// ── Activity proxies ──────────────────────────────────────────────────────────

const acts = proxyActivities<typeof AllActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

const quickActs = proxyActivities<typeof AllActivities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 3 },
});

// Best-effort cleanup on terminal events — no retries, short timeout, errors swallowed
const cleanupActs = proxyActivities<typeof AllActivities>({
  startToCloseTimeout: "5 seconds",
  retry: { maximumAttempts: 1 },
});

// ── Signal definition ─────────────────────────────────────────────────────────

export const domainEventSignal = defineSignal<[DomainEvent]>("domain_event");
export const currentStageQuery = defineQuery<string>("currentStage");

// ── Helpers (workflow-local, no I/O) ─────────────────────────────────────────

function hasAnyProcessableEvent(events: DomainEvent[], journeyConfig: JourneyConfig): boolean {
  return events.some((e) =>
    journeyConfig.stages.some((s) => journeyConfig.stages_map[s]?.events?.[e.event_type] !== undefined)
  );
}

function popAnyProcessableEvent(
  events: DomainEvent[],
  journeyConfig: JourneyConfig
): { event: DomainEvent; targetStage: string; targetCfg: StageConfig } | null {
  // Scan from end (latest event wins after debounce), search across all stages
  for (let i = events.length - 1; i >= 0; i--) {
    for (const stageName of journeyConfig.stages) {
      const cfg = journeyConfig.stages_map[stageName];
      if (cfg?.events?.[events[i].event_type] !== undefined) {
        return { event: events.splice(i, 1)[0], targetStage: stageName, targetCfg: cfg };
      }
    }
  }
  return null;
}

function resolveActivityFn(action: string): (args: ActionArgs) => Promise<void> {
  const map: Record<string, (args: ActionArgs) => Promise<void>> = {
    send_wa_message:         acts.sendWaMessage,
    send_wa_template:        acts.sendWaTemplate,
    advance_langgraph_state: acts.advanceLanggraphState,
    trigger_voice_call:      acts.triggerVoiceCall,
    cancel_all_nudges:       acts.cancelAllNudges,
    set_journey_paused:      acts.setJourneyPaused,
    push_to_scrm:            acts.pushToScrm,
    update_lead_stage:       acts.updateLeadStage,
  };
  const fn = map[action];
  if (!fn) throw new Error(`Unknown activity action: "${action}"`);
  return fn;
}

async function execAction(
  cfg: ActionCfg,
  phone: string,
  eventData?: Record<string, unknown>
): Promise<void> {
  const fn = resolveActivityFn(cfg.action);
  await fn({
    phone,
    template: cfg.template,
    replacements: cfg.replacements,
    nextNode: cfg.next_node,
    eventData: cfg.use_event_data ? eventData : undefined,
  });
}

async function sendNudge(rung: NudgeRung, phone: string): Promise<void> {
  const windowInfo = await quickActs.getWaWindowState({ phone });
  const elapsed = windowInfo.elapsed_hours;

  let temperature: "hot" | "warm" | "cold";
  if (elapsed == null) {
    temperature = "cold";
  } else if (elapsed < 0.75) {
    temperature = "hot";
  } else if (elapsed < 24) {
    temperature = "warm";
  } else {
    temperature = "cold";
  }

  const actionCfg =
    windowInfo.state === "open" && rung.action_open
      ? rung.action_open
      : (rung.action_closed ?? rung.action_open);

  if (!actionCfg) return;

  const fn = resolveActivityFn(actionCfg.action);
  await fn({
    phone,
    template: actionCfg.template,
    replacements: actionCfg.replacements,
    temperature,
    elapsedHours: elapsed ?? undefined,
  });
}

async function processEvent(
  stageCfg: StageConfig,
  event: DomainEvent,
  phone: string
): Promise<string> {
  const transition = stageCfg.events?.[event.event_type] as EventTransition | undefined;
  if (!transition) return "completed";

  if (transition.action) {
    const fn = resolveActivityFn(transition.action);
    await fn({
      phone,
      template: transition.template,
      replacements: transition.replacements,
      nextNode: transition.next_node,
      eventData: event.data,
      stage: transition.next_stage,
    });
  }
  return transition.next_stage;
}

// ── Workflow ──────────────────────────────────────────────────────────────────

function isTerminalEvent(type: string): boolean {
  return (
    type === "not_interested" ||
    type === "no_smartphone" ||
    type === "blocker_unresolvable" ||
    type === "tc_assigned"
  );
}

function hasTerminalEvent(evts: DomainEvent[]): boolean {
  return evts.some((e) => isTerminalEvent(e.event_type));
}

async function debounceIfConfigured(
  events: DomainEvent[],
  stageCfg: StageConfig,
  phone: string,
  currentStage: string,
  skipDebounce?: boolean,
  debounceOverrideMs?: number
): Promise<void> {
  if (skipDebounce) return;
  if (!stageCfg.debounce_minutes) return;  // stage not configured for debounce
  const debounceMs = debounceOverrideMs ?? minutesToMs(stageCfg.debounce_minutes);
  if (debounceMs <= 0) return;

  log.info("debounce start", { phone, currentStage, debounceMinutes: stageCfg.debounce_minutes });
  while (true) {
    const sizeBefore = events.length;
    const newArrived = await condition(
      () => events.length > sizeBefore || hasTerminalEvent(events),
      debounceMs
    );
    if (!newArrived) break;                 // quiet window elapsed — proceed
    if (hasTerminalEvent(events)) break;    // terminal event — let outer loop handle
    log.info("debounce reset — new event arrived", { phone, currentStage, queueSize: events.length });
  }
  log.info("debounce end", { phone, currentStage, queueSize: events.length });
}

export async function OnboardingJourney(
  phone: string,
  client: string,
  resumeFrom?: string,
  testOptions?: { skipDebounce?: boolean; debounceMs?: number }
): Promise<void> {
  const events: DomainEvent[] = [];
  let currentStage = "";
  setHandler(currentStageQuery, () => currentStage);

  setHandler(domainEventSignal, (event: DomainEvent) => {
    log.info("signal received", { phone, eventType: event.event_type, isTerminal: isTerminalEvent(event.event_type) });
    if (event.event_type !== EventType.RESTART_JOURNEY) {
      events.push(event);
    }
  });

  log.info("workflow started", { phone, client, resumeFrom });
  const journeyConfig: JourneyConfig = await acts.fetchJourneyConfig(client);
  log.info("config loaded", { phone, stages: journeyConfig.stages });
  currentStage = resumeFrom ?? journeyConfig.stages[0];

  while (currentStage !== "completed" && currentStage !== "give_up") {
    log.info("loop iteration", { phone, currentStage, queuedEvents: events.map((e) => e.event_type) });

    // ── Terminal event in queue → cancel engagement and exit ─────────────────
    if (hasTerminalEvent(events)) {
      log.info("terminal event detected — terminating", { phone, events: events.map((e) => e.event_type) });
      try { await acts.markGiveUp({ phone }); } catch { /* ignore */ }
      try { await cleanupActs.cancelAllNudges({ phone }); } catch { /* ignore */ }
      try { await cleanupActs.cancelPendingCallbacks({ phone }); } catch { /* ignore */ }
      log.info("workflow terminated via terminal event", { phone });
      break;
    }

    const stageCfg = journeyConfig.stages_map[currentStage];
    if (!stageCfg) {
      log.warn("unknown stage — exiting", { phone, currentStage });
      break;
    }

    if (stageCfg.on_enter) {
      log.info("running on_enter", { phone, currentStage, action: stageCfg.on_enter.action });
      await execAction(stageCfg.on_enter, phone);
    }

    if (stageCfg.demand_check_required) {
      const hasDemand = await acts.checkDemandInZone({ phone, jobType: client });
      if (!hasDemand) {
        log.info("no demand — sleeping 4h", { phone, currentStage });
        await sleepWithQuietHours(hoursToMs(4));
        continue;
      }
    }

    const minWait = stageCfg.min_wait_hours ?? 0;
    if (minWait > 0) {
      log.info("waiting min_wait", { phone, currentStage, minWaitHours: minWait });
      await condition(
        () => hasAnyProcessableEvent(events, journeyConfig) || hasTerminalEvent(events),
        hoursToMs(minWait)
      );
      log.info("min_wait condition woke", { phone, currentStage, hasTerminal: hasTerminalEvent(events) });
      if (!hasTerminalEvent(events)) {
        await debounceIfConfigured(events, stageCfg, phone, currentStage, testOptions?.skipDebounce, testOptions?.debounceMs);
        if (!hasTerminalEvent(events)) {
          const found = popAnyProcessableEvent(events, journeyConfig);
          if (found) {
            if (found.targetStage !== currentStage) log.info("stage skip", { phone, from: currentStage, to: found.targetStage, eventType: found.event.event_type });
            currentStage = await processEvent(found.targetCfg, found.event, phone);
          }
        }
      }
      continue;
    }

    const ladder = stageCfg.nudge_ladder ?? [];

    if (ladder.length === 0) {
      log.info("waitlist — waiting indefinitely", { phone, currentStage });
      await condition(() => hasAnyProcessableEvent(events, journeyConfig) || hasTerminalEvent(events));
      log.info("waitlist condition woke", { phone, currentStage, hasTerminal: hasTerminalEvent(events) });
      if (!hasTerminalEvent(events)) {
        await debounceIfConfigured(events, stageCfg, phone, currentStage, testOptions?.skipDebounce, testOptions?.debounceMs);
        if (!hasTerminalEvent(events)) {
          const found = popAnyProcessableEvent(events, journeyConfig);
          if (found) {
            if (found.targetStage !== currentStage) log.info("stage skip", { phone, from: currentStage, to: found.targetStage, eventType: found.event.event_type });
            currentStage = await processEvent(found.targetCfg, found.event, phone);
          }
        }
      }
      continue;
    }

    let advanced = false;

    for (let i = 0; i < ladder.length; i++) {
      const rung = ladder[i];
      const isLast = i === ladder.length - 1;

      log.info("ladder waiting", { phone, currentStage, rung: i, waitHours: rung.wait_hours });
      const eventArrived = await condition(
        () => hasAnyProcessableEvent(events, journeyConfig) || hasTerminalEvent(events),
        hoursToMs(rung.wait_hours)
      );
      log.info("ladder condition woke", { phone, currentStage, rung: i, eventArrived, hasTerminal: hasTerminalEvent(events) });

      if (eventArrived) {
        if (hasTerminalEvent(events)) {
          log.info("terminal event woke ladder — breaking", { phone, currentStage, rung: i });
          advanced = true;
          break;
        }
        await debounceIfConfigured(events, stageCfg, phone, currentStage, testOptions?.skipDebounce, testOptions?.debounceMs);
        if (hasTerminalEvent(events)) {
          log.info("terminal event during debounce — breaking", { phone, currentStage, rung: i });
          advanced = true;
          break;
        }
        const found = popAnyProcessableEvent(events, journeyConfig);
        if (found) {
          if (found.targetStage !== currentStage) log.info("stage skip", { phone, from: currentStage, to: found.targetStage, eventType: found.event.event_type });
          log.info("processing event", { phone, currentStage, eventType: found.event.event_type });
          currentStage = await processEvent(found.targetCfg, found.event, phone);
          log.info("stage transition", { phone, newStage: currentStage });
          advanced = true;
          break;
        }
      }

      if (isLast) {
        log.info("ladder exhausted — give_up", { phone, currentStage });
        if (rung.on_exhaust) await execAction(rung.on_exhaust, phone);
        await acts.markGiveUp({ phone });
        currentStage = "give_up";
        advanced = true;
        break;
      } else {
        log.info("sending nudge", { phone, currentStage, rung: i });
        await sleepWithQuietHours(0);
        await sendNudge(rung, phone);
      }
    }

    if (!advanced) {
      log.warn("loop fell through without advancing — give_up", { phone, currentStage });
      await acts.markGiveUp({ phone });
      currentStage = "give_up";
    }
  }

  log.info("workflow finished", { phone, finalStage: currentStage });
}
