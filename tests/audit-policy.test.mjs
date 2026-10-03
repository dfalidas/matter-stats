import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { enforcePolicy, evaluateAuditProcess } from "../scripts/audit-policy.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/audit/${name}.json`, import.meta.url), "utf8"));
const clean = () => fixture("clean");

function enforceFull(name) {
  return () => enforcePolicy(fixture(name), clean());
}

test("a realistic clean audit passes", () => assert.doesNotThrow(() => enforcePolicy(clean(), clean())));
test("the documented development-only advisory passes", () =>
  assert.doesNotThrow(enforceFull("allowed-development")));
test("accepted major-version and downgrade proposals do not end the exception", () =>
  assert.doesNotThrow(enforceFull("allowed-development")));
test("an available compatible remediation ends the exception", () =>
  assert.throws(enforceFull("compatible-fix"), /compatible remediation is available/));
test("new high and critical advisories fail", () =>
  assert.throws(enforceFull("new-high"), /outside/));
test("mixed advisory chains fail", () =>
  assert.throws(enforceFull("mixed"), /outside/));
test("any production vulnerability fails", () =>
  assert.throws(() => enforcePolicy(fixture("allowed-development"), fixture("allowed-development")), /zero/));
test("an array vulnerabilities payload fails even with zero counters", () =>
  assert.throws(enforceFull("array-vulnerabilities"), /incomplete|unsupported/));
test("negative and contradictory severity counters fail", () =>
  assert.throws(enforceFull("negative-counter"), /invalid high count/));
test("a missing required counter fails", () =>
  assert.throws(enforceFull("incomplete-report"), /invalid total count/));
test("severity counters must match the actual entries", () =>
  assert.throws(enforceFull("severity-mismatch"), /high count does not match/));
test("an unresolved via reference fails", () =>
  assert.throws(enforceFull("unresolved-via"), /unresolved via/));
test("a cyclic advisory chain fails", () =>
  assert.throws(enforceFull("cyclic-via"), /outside/));
test("malformed remediation metadata fails conservatively", () =>
  assert.throws(enforceFull("malformed-fix"), /malformed remediation/));
test("an explicit npm audit error payload fails", () =>
  assert.throws(() => evaluateAuditProcess({ status: 1, stdout: '{"error":{"code":"E403"}}' }, "full"), /explicit error/));
test("a subprocess error fails", () =>
  assert.throws(() => evaluateAuditProcess({ status: null, error: new Error("network failed"), stdout: "" }, "full"), /transport failed/));
test("a signal fails", () =>
  assert.throws(() => evaluateAuditProcess({ status: null, signal: "SIGTERM", stdout: "" }, "full"), /transport failed/));
test("an unsupported exit status fails", () =>
  assert.throws(() => evaluateAuditProcess({ status: 2, stdout: "{}" }, "full"), /transport failed/));
test("malformed JSON fails", () =>
  assert.throws(() => evaluateAuditProcess({ status: 0, stdout: "not json" }, "full"), /valid JSON/));
