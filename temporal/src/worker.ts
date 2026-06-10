import { Worker, NativeConnection } from "@temporalio/worker";
import { fileURLToPath } from "url";
import path from "path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import * as activities from "./activities/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const connection = await NativeConnection.connect({
    address: config.TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    // Workflows are bundled separately — point to the compiled JS file
    workflowsPath: path.join(__dirname, "workflows/index.ts"),
    activities,
  });

  logger.info(
    {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      temporal: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
    },
    "Temporal journey worker starting"
  );

  await worker.run();
}

main().catch((err) => {
  logger.error(err, "Worker failed to start");
  process.exit(1);
});
