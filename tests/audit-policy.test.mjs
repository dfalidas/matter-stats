import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { enforcePolicy, evaluateAuditProcess } from "../scripts/audit-policy.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/audit/${name}.json`, import.meta.url), "utf8"));
const clean = () => fixture("clean");

test("a clean audit passes", () => assert.doesNotThrow(() => enforcePolicy(clean(), clean())));
test("the documented development-only advisory passes", () =>
  assert.doesNotThrow(() => enforcePolicy(fixture("allowed-development"), clean())));
test("a new high or critical advisory fails", () =>
  assert.throws(() => enforcePolicy(fixture("new-high"), clean()), /outside/));
test("the exception in production fails", () =>
  assert.throws(() => enforcePolicy(fixture("allowed-development"), fixture("allowed-development")), /zero/));
test("the exception plus another advisory fails", () =>
  assert.throws(() => enforcePolicy(fixture("mixed"), clean()), /outside/));
test("a transport error fails", () =>
  assert.throws(() => evaluateAuditProcess({ status: 1, stdout: "", stderr: "403 Forbidden" }, "full"), /valid JSON/));
test("malformed input fails", () =>
  assert.throws(() => evaluateAuditProcess({ status: 0, stdout: "not json" }, "full"), /valid JSON/));
