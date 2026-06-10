import { z } from "zod";
import dotenv from "dotenv";
dotenv.config();

const schema = z.object({
  TEMPORAL_ADDRESS:        z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE:      z.string().default("default"),
  TEMPORAL_TASK_QUEUE:     z.string().default("journey-workflow"),
  DATABASE_URL:            z.string().default("postgresql://postgres:postgres@localhost:5432/journey"),
  CALL_ACTION_URL:         z.string().default("http://localhost:4000"),
  LOG_LEVEL:               z.string().default("info"),
});

export const config = schema.parse(process.env);
