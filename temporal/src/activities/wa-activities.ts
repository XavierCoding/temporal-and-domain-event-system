import { config } from "../config.js";
import { logger } from "../logger.js";
import { ActionArgs } from "../schemas/action-args.js";

const TEST_MODE = process.env.TEST_MODE === "true";

async function callAction(action: string, args: ActionArgs): Promise<void> {
  const res = await fetch(`${config.CALL_ACTION_URL}/callAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...args }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from callAction (${action}): ${await res.text()}`);
  }
}

export async function sendWaMessage(args: ActionArgs): Promise<void> {
  if (TEST_MODE) { logger.info({ phone: args.phone }, "[TEST] sendWaMessage"); return; }
  await callAction("send_wa_message", args);
  logger.info({ phone: args.phone }, "WA free-form message sent");
}

export async function sendWaTemplate(args: ActionArgs): Promise<void> {
  if (TEST_MODE) { logger.info({ phone: args.phone, template: args.template }, "[TEST] sendWaTemplate"); return; }
  await callAction("send_wa_template", args);
  logger.info({ phone: args.phone, template: args.template }, "WA template sent");
}

export async function getWaWindowState(
  args: ActionArgs
): Promise<{ state: "open" | "closed"; elapsed_hours: number | null }> {
  if (TEST_MODE) return { state: "closed", elapsed_hours: 48 };
  const url = new URL(`${config.CALL_ACTION_URL}/waWindowState`);
  url.searchParams.set("phone", args.phone);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from waWindowState`);
  return res.json() as Promise<{ state: "open" | "closed"; elapsed_hours: number | null }>;
}

export async function checkDemandInZone(args: ActionArgs): Promise<boolean> {
  if (TEST_MODE) return true;
  const url = new URL(`${config.CALL_ACTION_URL}/demandInZone`);
  url.searchParams.set("city", args.city ?? "");
  url.searchParams.set("job_type", args.jobType ?? "");
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from demandInZone`);
  const data = (await res.json()) as { has_demand: boolean };
  return data.has_demand;
}

export async function advanceLanggraphState(args: ActionArgs): Promise<void> {
  if (TEST_MODE) { logger.info({ phone: args.phone, nextNode: args.nextNode }, "[TEST] advanceLanggraphState"); return; }
  await callAction("advance_langgraph_state", args);
  logger.info({ phone: args.phone, nextNode: args.nextNode }, "langgraph state advanced");
}

export async function cancelAllNudges(args: ActionArgs): Promise<void> {
  if (TEST_MODE) { logger.info({ phone: args.phone }, "[TEST] cancelAllNudges"); return; }
  await callAction("cancel_all_nudges", args);
  logger.info({ phone: args.phone }, "all nudges cancelled");
}

export async function setJourneyPaused(args: ActionArgs): Promise<void> {
  if (TEST_MODE) { logger.info({ phone: args.phone }, "[TEST] setJourneyPaused"); return; }
  await callAction("set_journey_paused", args);
  logger.info({ phone: args.phone, paused: args.paused }, "journey pause state set");
}
