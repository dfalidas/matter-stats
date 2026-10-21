import { mkdirSync, writeFileSync } from "node:fs";
import { executionIdentity } from "./database-evidence.mjs";
const identity = executionIdentity();
const directory = `artifacts/task24/${identity.testedSha}`;
mkdirSync(directory, { recursive: true });
writeFileSync(
  `${directory}/ci.json`,
  JSON.stringify(
    {
      ...identity,
      environment: "B: local isolated full-stack",
      verificationOutcome: process.env.TASK24_STEP_OUTCOME ?? "not-run",
      hostedStaging: "blocked",
      production: "not-run",
      realScheduledDelivery: "not-run",
    },
    null,
    2,
  ) + "\n",
);
