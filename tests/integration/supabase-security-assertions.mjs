import assert from "node:assert/strict";

/**
 * The hardening migrations revoke object grants from browser roles. PostgreSQL
 * reports that specific boundary as insufficient_privilege (SQLSTATE 42501).
 * An RLS-filtered success or any other error is not evidence for this contract.
 */
export function assertGrantDenied(result, context) {
  assert.ok(result && typeof result === "object", `${context}: request produced no structured result`);
  assert.ok(result.error, `${context}: expected grant denial, but the request succeeded (RLS filtering is not grant denial)`);
  assert.equal(
    result.error.code,
    "42501",
    `${context}: expected PostgreSQL insufficient_privilege (42501), received ${result.error.code ?? "an unclassified error"}`,
  );
}

export function assertSuccessful(result, context) {
  assert.ok(result && typeof result === "object", `${context}: request produced no structured result`);
  assert.equal(result.error, null, `${context}: ${result.error?.code ?? "unknown"} ${result.error?.message ?? "request failed"}`);
}
