import { config } from "../config.js";
import { logger } from "../logger.js";
import { getChannel } from "./connection.js";
import { handleEvent } from "../handlers/event-handler.js";
import { DomainEvent, EventType } from "../types/domain-event.js";

function isValidEventType(value: string): value is EventType {
  return Object.values(EventType).includes(value as EventType);
}

function parseDomainEvent(raw: string): DomainEvent | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.phone_number !== "string" ||
      typeof parsed.event_type !== "string" ||
      typeof parsed.client !== "string" ||
      !isValidEventType(parsed.event_type)
    ) {
      logger.warn({ parsed }, "invalid domain event shape — skipping");
      return null;
    }
    return parsed as DomainEvent;
  } catch (err) {
    logger.warn({ raw, err }, "failed to parse domain event JSON — skipping");
    return null;
  }
}

export async function startStreamConsumer(): Promise<void> {
  const channel = await getChannel();

  await channel.consume(
    config.STREAM_NAME,
    async (msg) => {
      if (!msg) return;

      const raw = msg.content.toString("utf-8");
      logger.debug({ raw }, "received raw message");

      const event = parseDomainEvent(raw);

      if (!event) {
        // Dead-letter: don't requeue malformed messages
        channel.nack(msg, false, false);
        return;
      }

      try {
        await handleEvent(event);
        channel.ack(msg);
      } catch (err) {
        logger.error({ err, phone: event.phone_number, eventType: event.event_type }, "event handling failed");
        // Requeue once so a transient failure (e.g. Temporal unavailable) gets retried
        channel.nack(msg, false, true);
      }
    },
    { noAck: false }
  );

  logger.info({ stream: config.STREAM_NAME }, "stream consumer started");
}
