import cluster from "cluster";
import * as dotenv from "dotenv";
import { assertLocalRuntimeBoundary } from "./LocalRuntimeBoundary";

// Load environment variables before we read configuration values derived from them.
dotenv.config();

// Main entry point of the application
async function main() {
  // This check intentionally runs before Master/Worker are imported. Those
  // modules construct log/telemetry and integration dependencies at import or
  // startup time, so validating afterward would be too late.
  assertLocalRuntimeBoundary();

  // Check if this is the primary (master) process
  if (cluster.isPrimary) {
    console.log("Starting master process...");
    const { startMaster } = await import("./Master");
    await startMaster();
  } else {
    // This is a worker process
    console.log("Starting worker process...");
    const { startWorker } = await import("./Worker");
    await startWorker();
  }
}

// Start the application
main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
