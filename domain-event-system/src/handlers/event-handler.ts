import { logger } from "../logger.js";
import { signalJourney } from "../temporal/journey-signaler.js";
import { DomainEvent } from "../types/domain-event.js";

export async function handleEvent(event: DomainEvent): Promise<void> {
  logger.info(
    { phone: event.phone_number, type: event.event_type, client: event.client },
    "handling domain event"
  );
  await signalJourney(event);
}
