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

export async function triggerVoiceCall(args: ActionArgs): Promise<void> {
  if (TEST_MODE) { logger.info({ phone: args.phone }, "[TEST] triggerVoiceCall"); return; }
  await callAction("trigger_voice_call", args);
  logger.info({ phone: args.phone }, "voice call triggered");
}

export async function cancelPendingCallbacks(args: ActionArgs): Promise<void> {
  if (TEST_MODE) { logger.info({ phone: args.phone }, "[TEST] cancelPendingCallbacks"); return; }
  await callAction("cancel_pending_callbacks", args);
  logger.info({ phone: args.phone }, "pending callbacks cancelled");
}
