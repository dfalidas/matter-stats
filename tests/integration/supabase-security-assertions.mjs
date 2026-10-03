import assert from "node:assert/strict";

/**
 * The hardening migrations revoke object grants from browser roles. PostgreSQL
 * reports that specific boundary as insufficient_privilege (SQLSTATE 42501).
 * An RLS-filtered success or any other error is not evidence for this contract.
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function assertGrantDenied(result, { role, operation, kind, name }) {
  const context = `${role} ${operation} ${kind} ${name}`;
  assert.ok(result && typeof result === "object", `${context}: request produced no structured result`);
  assert.ok(result.error, `${context}: expected grant denial, but the request succeeded (RLS filtering is not grant denial)`);
  assert.equal(
    result.error.code,
    "42501",
    `${context}: expected PostgreSQL insufficient_privilege (42501), received ${result.error.code ?? "an unclassified error"}`,
  );
  assert.ok(kind === "table" || kind === "function", `${context}: unsupported grant target kind`);
  const expectedMessage = new RegExp(`^permission denied for ${kind} ${escapeRegExp(name)}$`);
  assert.match(
    result.error.message ?? "",
    expectedMessage,
    `${context}: 42501 did not identify the expected revoked ${kind} grant`,
  );
}

export function assertSuccessful(result, context) {
  assert.ok(result && typeof result === "object", `${context}: request produced no structured result`);
  assert.equal(result.error, null, `${context}: ${result.error?.code ?? "unknown"} ${result.error?.message ?? "request failed"}`);
}
