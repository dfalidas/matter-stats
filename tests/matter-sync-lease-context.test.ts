import assert from "node:assert/strict";
import test from "node:test";
import { leaseRpcArgs, type MatterSyncLease } from "../lib/matter-sync-lease-context";

test("lease generation remains exact above JavaScript's safe integer range", () => {
  const lease: MatterSyncLease = { accountScope: "matter", owner: "00000000-0000-4000-8000-000000000001", generation: "9007199254740993" };
  assert.equal(leaseRpcArgs(lease).p_generation, "9007199254740993");
});

test("missing and malformed lease context fails closed", () => {
  const valid = { accountScope: "matter", owner: "00000000-0000-4000-8000-000000000001", generation: "1" };
  for (const value of [undefined, null, {}, { ...valid, accountScope: "token" }, { ...valid, owner: null }, { ...valid, generation: "0" }, { ...valid, generation: 1 }, { ...valid, generation: "9223372036854775808" }]) {
    assert.throws(() => leaseRpcArgs(value as MatterSyncLease));
  }
});
