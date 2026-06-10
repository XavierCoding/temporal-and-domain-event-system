/**
 * E2E test — validates all stage transitions and terminal events.
 *
 * Requirements:
 *   1. Temporal running (localhost:7233)
 *   2. Worker running with TEST_MODE=true:
 *        TEST_MODE=true npm run dev
 *   3. DB running (for fetchJourneyConfig / markGiveUp)
 *
 * Run:
 *   npx tsx test-e2e.ts
 */
import { Client, Connection, WorkflowNotFoundError } from "@temporalio/client";
import { domainEventSignal, currentStageQuery } from "./src/workflows/onboarding-journey.js";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "journey-workflow";
const TEST_PHONE = "+919000000099"; // dedicated test number — won't conflict with real data
const CLIENT = "swiggy";

let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`  ✓ ${label}`);
  passed++;
}
function fail(label: string, detail?: string) {
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  failed++;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeEvent(eventType: string) {
  return {
    phone_number: TEST_PHONE,
    event_type: eventType,
    client: CLIENT,
    data: {},
    emitted_at: new Date().toISOString(),
  };
}

async function startWorkflow(client: Client, id: string, skipDebounce = true) {
  await client.workflow.start("OnboardingJourney", {
    taskQueue: TASK_QUEUE,
    workflowId: id,
    args: [TEST_PHONE, CLIENT, undefined, { skipDebounce }],
  });
}

async function signal(client: Client, id: string, eventType: string) {
  const handle = client.workflow.getHandle(id);
  await handle.signal(domainEventSignal, makeEvent(eventType));
}

async function getStage(client: Client, id: string): Promise<string> {
  return client.workflow.getHandle(id).query(currentStageQuery);
}

async function assertStage(client: Client, id: string, expected: string, label: string) {
  await sleep(400);
  const actual = await getStage(client, id);
  if (actual === expected) {
    ok(`${label} → stage=${actual}`);
  } else {
    fail(`${label}`, `expected stage=${expected}, got=${actual}`);
  }
}

async function terminate(client: Client, id: string) {
  try {
    await client.workflow.getHandle(id).terminate("e2e test reset");
    await sleep(300);
  } catch (e) {
    if (!(e instanceof WorkflowNotFoundError)) throw e;
  }
}

async function runHappyPath(client: Client) {
  console.log("\n── Test 1: Happy path (all stages) ──");
  const id = `journey-e2e-happy-${Date.now()}`;

  await startWorkflow(client, id);
  await sleep(500);
  await assertStage(client, id, "D1_location", "start");

  await signal(client, id, "location_shared");
  await assertStage(client, id, "O1_app_download", "location_shared");

  await signal(client, id, "app_downloaded");
  await assertStage(client, id, "O2_si", "app_downloaded");

  await signal(client, id, "si_filed");
  await assertStage(client, id, "O3_payment", "si_filed");

  await signal(client, id, "payment_done");
  await assertStage(client, id, "O4_activation", "payment_done");

  await signal(client, id, "activated");
  await assertStage(client, id, "O5_first_order", "activated");

  await signal(client, id, "fod");
  await sleep(800);
  try {
    const desc = await client.workflow.getHandle(id).describe();
    desc.status.name === "COMPLETED" ? ok("fod → workflow COMPLETED") : fail("fod → workflow COMPLETED", `status=${desc.status.name}`);
  } catch {
    fail("fod → workflow COMPLETED", "describe failed");
  }
}

async function runStageSkip(client: Client) {
  console.log("\n── Test 2: Stage skip (direct event for future stage) ──");
  const id = `journey-e2e-skip-${Date.now()}`;

  await startWorkflow(client, id);
  await sleep(500);
  await assertStage(client, id, "D1_location", "start");

  // Send app_downloaded while in D1_location — should skip O1 and land in O2_si
  await signal(client, id, "app_downloaded");
  await assertStage(client, id, "O2_si", "app_downloaded (skip D1→O2)");

  await terminate(client, id);
}

async function runTerminalAtStart(client: Client) {
  console.log("\n── Test 3: Terminal event at start (not_interested) ──");
  const id = `journey-e2e-term-${Date.now()}`;

  await startWorkflow(client, id);
  await sleep(500);
  await signal(client, id, "not_interested");
  await sleep(800);

  try {
    const desc = await client.workflow.getHandle(id).describe();
    desc.status.name === "COMPLETED" ? ok("not_interested → workflow COMPLETED") : fail("not_interested → workflow COMPLETED", `status=${desc.status.name}`);
  } catch {
    fail("not_interested → describe failed");
  }
}

async function runTerminalMidJourney(client: Client) {
  console.log("\n── Test 4: Terminal event mid-journey (tc_assigned in O2_si) ──");
  const id = `journey-e2e-term-mid-${Date.now()}`;

  await startWorkflow(client, id);
  await sleep(500);
  await signal(client, id, "location_shared");
  await sleep(400);
  await signal(client, id, "app_downloaded");
  await assertStage(client, id, "O2_si", "reached O2_si");

  await signal(client, id, "tc_assigned");
  await sleep(800);

  try {
    const desc = await client.workflow.getHandle(id).describe();
    desc.status.name === "COMPLETED" ? ok("tc_assigned → workflow COMPLETED") : fail("tc_assigned → workflow COMPLETED", `status=${desc.status.name}`);
  } catch {
    fail("tc_assigned → describe failed");
  }
}

async function runTerminalEvents(client: Client) {
  console.log("\n── Test 5: All terminal event types ──");
  const terminals = ["not_interested", "no_smartphone", "blocker_unresolvable", "tc_assigned"];

  for (const evt of terminals) {
    const id = `journey-e2e-terminal-${evt}-${Date.now()}`;
    await startWorkflow(client, id);
    await sleep(400);
    await signal(client, id, evt);
    await sleep(800);
    try {
      const desc = await client.workflow.getHandle(id).describe();
      desc.status.name === "COMPLETED" ? ok(`${evt} → COMPLETED`) : fail(`${evt} → COMPLETED`, `status=${desc.status.name}`);
    } catch {
      fail(`${evt} → describe failed`);
    }
  }
}

async function runDebounce(client: Client) {
  console.log("\n── Test 7: Debounce — events 15s apart, only one action fires ──");
  // Window is 20s; events arrive every 15s — each resets the window.
  // Only after a full 20s quiet period does the workflow advance.
  // (In production debounce_minutes may be higher — debounceMs overrides it regardless.)
  const DEBOUNCE_MS = 20_000;
  const EVENT_GAP_MS = 15_000;
  console.log(`    debounce window: ${DEBOUNCE_MS / 1000}s | event gap: ${EVENT_GAP_MS / 1000}s`);
  const id = `journey-e2e-debounce-${Date.now()}`;

  // skipDebounce: false + debounceMs overrides the window only for stages
  // that already have debounce_minutes configured (O2_si, O3_payment).
  // D1_location and O1_app_download have no debounce_minutes → unaffected.
  await client.workflow.start("OnboardingJourney", {
    taskQueue: TASK_QUEUE,
    workflowId: id,
    args: [TEST_PHONE, CLIENT, undefined, { skipDebounce: false, debounceMs: DEBOUNCE_MS }],
  });
  await sleep(500);

  // Advance to O2_si — these stages have no debounce so they process immediately
  await signal(client, id, "location_shared");
  await sleep(400);
  await signal(client, id, "app_downloaded");
  await assertStage(client, id, "O2_si", "reached O2_si");

  // Fire 3 events with 15s gaps — each resets the 20s debounce window
  console.log("    sending si_filed #1 …");
  await signal(client, id, "si_filed");
  await sleep(EVENT_GAP_MS);
  const s1 = await getStage(client, id);
  s1 === "O2_si" ? ok("still O2_si after event #1 (window reset)") : fail("still O2_si after event #1", `got=${s1}`);

  console.log("    sending si_filed #2 …");
  await signal(client, id, "si_filed");
  await sleep(EVENT_GAP_MS);
  const s2 = await getStage(client, id);
  s2 === "O2_si" ? ok("still O2_si after event #2 (window reset)") : fail("still O2_si after event #2", `got=${s2}`);

  console.log("    sending si_filed #3 — then waiting for quiet window …");
  await signal(client, id, "si_filed");

  // After DEBOUNCE_MS of silence the workflow should advance
  await sleep(DEBOUNCE_MS + 1000);
  await assertStage(client, id, "O3_payment", "advanced to O3_payment after quiet window");

  await terminate(client, id);
}

async function runAlternateEndings(client: Client) {
  console.log("\n── Test 6: Alternate endings (got_better_job) ──");
  const id = `journey-e2e-alt-${Date.now()}`;

  await startWorkflow(client, id);
  await sleep(400);
  await signal(client, id, "got_better_job");
  await sleep(800);

  try {
    const desc = await client.workflow.getHandle(id).describe();
    desc.status.name === "COMPLETED" ? ok("got_better_job → COMPLETED") : fail("got_better_job → COMPLETED", `status=${desc.status.name}`);
  } catch {
    fail("got_better_job → describe failed");
  }
}

async function main() {
  console.log("=== OnboardingJourney E2E Tests ===");
  console.log(`Temporal: ${TEMPORAL_ADDRESS} | Task queue: ${TASK_QUEUE}`);
  console.log("Note: worker must be running with TEST_MODE=true\n");

  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const client = new Client({ connection });

  try {
    await runHappyPath(client);
    await runStageSkip(client);
    await runTerminalAtStart(client);
    await runTerminalMidJourney(client);
    await runTerminalEvents(client);
    await runDebounce(client);
    await runAlternateEndings(client);
  } finally {
    await connection.close();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
