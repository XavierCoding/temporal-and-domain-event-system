import { config } from "./config.js";
import { logger } from "./logger.js";
import { startStreamConsumer } from "./rabbitmq/stream-consumer.js";
import { closeConnection } from "./rabbitmq/connection.js";

async function main(): Promise<void> {
  logger.info("Starting Domain Event Service");
  logger.info({ stream: config.STREAM_NAME, temporal: config.TEMPORAL_ADDRESS }, "config loaded");

  await startStreamConsumer();
  logger.info("Domain Event Service running — waiting for events");
}

function shutdown(): void {
  logger.info("Shutting down...");
  closeConnection().finally(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch((err) => {
  logger.error(err, "Fatal startup error");
  process.exit(1);
});
