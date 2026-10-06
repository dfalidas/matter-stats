#!/usr/bin/env node
import { runStabilizationDatabases } from "./stabilization-db-orchestrator.mjs";

// Ordinary tests stay database-free. The explicit disposable acknowledgement
// opts into the same guarded fresh/upgrade runner used by test:stabilization-db.
if (process.env.DISPOSABLE_DB_ACK !== undefined) {
  const result = await runStabilizationDatabases();
  if (result.status !== "passed") {
    console.error(`BLOCKED: ${result.reason}`);
    process.exitCode = 2;
  } else {
    console.log(`Fresh and upgrade database verification passed for ${result.gitSha}.`);
  }
}
