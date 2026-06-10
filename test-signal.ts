/**
 * Test script — directly signals Temporal workflows.
 * Bypasses RabbitMQ/domain-event-system. Good for testing workers in isolation.
 *
 * Usage:
 *   npx tsx test-signal.ts start        +919999999999 swiggy        — start OnboardingJourney
 *   npx tsx test-signal.ts start-intent +919999999999 swiggy        — start IntentJourney
 *   npx tsx test-signal.ts signal       +919999999999 location_shared
 *   npx tsx test-signal.ts signal-intent +919999999999 samvadini_interested
 *   npx tsx test-signal.ts status       +919999999999
 *   npx tsx test-signal.ts status-intent +919999999999
 */
import { Client, Connection, WorkflowNotFoundError } from "@temporalio/client";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "journey-workflow";

const [, , command, phone, arg] = process.argv;

if (!command || !phone) {
  printHelp();
  process.exit(1);
}

function printHelp() {
  console.log("Usage:");
  console.log("  npx tsx test-signal.ts start         <phone> [client]  — start OnboardingJourney");
  console.log("  npx tsx test-signal.ts start-intent  <phone> [client]  — start IntentJourney");
  console.log("  npx tsx test-signal.ts signal        <phone> <event>   — signal OnboardingJourney");
  console.log("  npx tsx test-signal.ts signal-intent <phone> <event>   — signal IntentJourney");
  console.log("  npx tsx test-signal.ts status        <phone>           — status of OnboardingJourney");
  console.log("  npx tsx test-signal.ts status-intent <phone>           — status of IntentJourney");
  console.log("");
  console.log("OnboardingJourney events:");
  console.log("  location_shared, app_downloaded, si_filed, payment_done,");
  console.log("  activated, fod, got_better_job, blocker_unresolvable,");
  console.log("  not_interested, no_smartphone, tc_assigned, restart_journey");
  console.log("");
  console.log("IntentJourney events:");
  console.log("  samvadini_interested  — rider is interested, handoff to OnboardingJourney");
  console.log("  not_interested        — rider not interested, TC assigned to VL server");
  console.log("  referral_received     — referral signal (informational)");
}

const onboardingId = `journey-${phone}`;
const intentId     = `intent-${phone}`;
const client_      = arg ?? "swiggy";

function makeEvent(eventType: string) {
  return {
    phone_number: phone,
    event_type:   eventType,
    client:       client_,
    data:         {},
    emitted_at:   new Date().toISOString(),
  };
}

async function main() {
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const client = new Client({ connection });

  if (command === "start") {
    await client.workflow.start("OnboardingJourney", {
      taskQueue: TASK_QUEUE,
      workflowId: onboardingId,
      args: [phone, client_],
    });
    console.log(`✓ Started OnboardingJourney  id=${onboardingId}  client=${client_}`);
    console.log(`  UI: http://localhost:8233/namespaces/default/workflows/${onboardingId}`);

  } else if (command === "start-intent") {
    await client.workflow.start("IntentJourney", {
      taskQueue: TASK_QUEUE,
      workflowId: intentId,
      args: [phone, client_],
    });
    console.log(`✓ Started IntentJourney  id=${intentId}  client=${client_}`);
    console.log(`  UI: http://localhost:8233/namespaces/default/workflows/${intentId}`);

  } else if (command === "signal") {
    if (!arg) { console.error("event type required"); process.exit(1); }
    try {
      await client.workflow.getHandle(onboardingId).signal("domain_event", makeEvent(arg));
      console.log(`✓ Signalled ${onboardingId}  event_type=${arg}`);
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        console.error(`✗ Workflow ${onboardingId} not found — run 'start' first`);
      } else throw err;
    }

  } else if (command === "signal-intent") {
    if (!arg) { console.error("event type required"); process.exit(1); }
    try {
      await client.workflow.getHandle(intentId).signal("domain_event", makeEvent(arg));
      console.log(`✓ Signalled ${intentId}  event_type=${arg}`);
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        console.error(`✗ Workflow ${intentId} not found — run 'start-intent' first`);
      } else throw err;
    }

  } else if (command === "status" || command === "status-intent") {
    const id = command === "status" ? onboardingId : intentId;
    try {
      const desc = await client.workflow.getHandle(id).describe();
      console.log(`Workflow:    ${id}`);
      console.log(`  Status:    ${desc.status.name}`);
      console.log(`  Started:   ${desc.startTime}`);
      console.log(`  Task queue: ${desc.taskQueue}`);
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        console.error(`✗ Workflow ${id} not found`);
      } else throw err;
    }

  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }

  await connection.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
