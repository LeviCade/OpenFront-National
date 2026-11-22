import cluster from "cluster";
import * as dotenv from "dotenv";
import { startMaster } from "./Master";
import { ServerEnv } from "./ServerEnv";
import { startWorker } from "./Worker";

// Load environment variables before we read configuration values derived from them.
dotenv.config();

// Main entry point of the application
async function main() {
  // Validate before starting the master, forking a worker or calling an API.
  ServerEnv.localNationalStaging();
  // Check if this is the primary (master) process
  if (cluster.isPrimary) {
    console.log("Starting master process...");
    await startMaster();
  } else {
    // This is a worker process
    console.log("Starting worker process...");
    await startWorker();
  }
}

// Start the application
main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
