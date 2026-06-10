import { WorkflowNotFoundError } from "@temporalio/client";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getTemporalClient } from "./client.js";
import { DomainEvent } from "../types/domain-event.js";

const WORKFLOW_TYPE = "OnboardingJourney";
const SIGNAL_NAME = "domain_event";

export async function signalJourney(event: DomainEvent): Promise<void> {
  const client = await getTemporalClient();
  const workflowId = `journey-${event.phone_number}`;

  try {
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal(SIGNAL_NAME, event);
    logger.info({ workflowId, eventType: event.event_type }, "signalled existing workflow");
  } catch (err) {
    // If workflow doesn't exist yet, start it then signal
    if (err instanceof WorkflowNotFoundError) {
      logger.info({ workflowId, client: event.client }, "workflow not found — starting new one");
      await client.workflow.start(WORKFLOW_TYPE, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId,
        args: [event.phone_number, event.client],
      });
      const handle = client.workflow.getHandle(workflowId);
      await handle.signal(SIGNAL_NAME, event);
      logger.info({ workflowId }, "started and signalled new workflow");
    } else {
      throw err;
    }
  }
}
