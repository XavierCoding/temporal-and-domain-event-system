/**
 * Publish a domain event to the journey-events RabbitMQ stream.
 * Tests the full path: RabbitMQ → domain-event-system → Temporal signal → workflow.
 *
 * Usage:
 *   npx tsx publish-event.ts <phone> <event_type> [client]
 *
 * Examples:
 *   npx tsx publish-event.ts +919999999999 location_shared
 *   npx tsx publish-event.ts +919999999999 app_downloaded swiggy
 *   npx tsx publish-event.ts +919999999999 tc_assigned
 *   npx tsx publish-event.ts +919999999999 restart_journey
 */
import amqplib from "amqplib";

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";
const STREAM_NAME  = process.env.STREAM_NAME  ?? "journey-events";

const [, , phone, eventType, client = "swiggy"] = process.argv;

if (!phone || !eventType) {
  console.log("Usage: npx tsx publish-event.ts <phone> <event_type> [client=swiggy]");
  console.log("\nEvent types:");
  console.log("  location_shared, app_downloaded, si_filed, payment_done,");
  console.log("  activated, fod, got_better_job, blocker_unresolvable,");
  console.log("  tc_assigned, restart_journey, not_interested");
  process.exit(1);
}

const event = {
  phone_number: phone,
  event_type:   eventType,
  client,
  data:         {},
  emitted_at:   new Date().toISOString(),
};

async function main() {
  const conn = await amqplib.connect(RABBITMQ_URL);
  const ch   = await conn.createChannel();

  await ch.assertQueue(STREAM_NAME, {
    durable:   true,
    arguments: { "x-queue-type": "stream" },
  });

  ch.sendToQueue(
    STREAM_NAME,
    Buffer.from(JSON.stringify(event)),
    { persistent: true }
  );

  console.log(`✓ Published to stream "${STREAM_NAME}"`);
  console.log(`  phone=${phone}  event_type=${eventType}  client=${client}`);

  await ch.close();
  await conn.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
