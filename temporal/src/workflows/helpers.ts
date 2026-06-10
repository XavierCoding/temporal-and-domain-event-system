import { sleep } from "@temporalio/workflow";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30 in milliseconds

/**
 * Sleep for `delayMs`, then hold in a loop until the current IST time
 * is within the allowed window (08:00–21:00). Wakes every hour to re-check.
 */
export async function sleepWithQuietHours(delayMs: number): Promise<void> {
  await sleep(delayMs);
  while (true) {
    // Date.now() is deterministic inside Temporal workflows
    const nowMs = Date.now();
    const istMs = (nowMs + IST_OFFSET_MS) % (24 * 60 * 60 * 1000);
    const istHour = istMs / (60 * 60 * 1000);
    if (istHour >= 8 && istHour < 21) break;
    await sleep("1 hour");
  }
}

export function hoursToMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

export function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}
