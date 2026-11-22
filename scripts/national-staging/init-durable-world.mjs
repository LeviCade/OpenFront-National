import { initializeDurableNationalRoot } from "../../src/server/national/DurableNationalStore.ts";

const [root, workers, ...extras] = process.argv.slice(2);
if (!root || !/^[1-9][0-9]*$/.test(workers ?? "") || extras.length)
  throw new Error("usage: node scripts/national-staging/init-durable-world.mjs /absolute/new/root workers");
initializeDurableNationalRoot(root, Number(workers));
console.log("NATIONAL_RECOVERY_ROOT_INITIALIZED");
