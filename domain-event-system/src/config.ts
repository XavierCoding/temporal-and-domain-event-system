import { z } from "zod";
import dotenv from "dotenv";
dotenv.config();

const schema = z.object({
  RABBITMQ_URL:        z.string().default("amqp://guest:guest@localhost:5672"),
  STREAM_NAME:         z.string().default("journey-events"),
  TEMPORAL_ADDRESS:    z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE:  z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("journey-workflow"),
  LOG_LEVEL:           z.string().default("info"),
});

export const config = schema.parse(process.env);
