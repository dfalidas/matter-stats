/** Independent of stream cycle_generation; BIGINT is carried losslessly as text. */
export type MatterSyncLease = {
  accountScope: "matter";
  owner: string;
  generation: string;
};

export class MatterSyncLeaseLostError extends Error {
  constructor() {
    super("Matter sync account ownership was lost. Retry after the current sync finishes.");
    this.name = "MatterSyncLeaseLostError";
  }
}

export function leaseRpcArgs(lease: MatterSyncLease) {
  if (!lease || lease.accountScope !== "matter"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lease.owner)
    || typeof lease.generation !== "string" || !/^[1-9][0-9]*$/.test(lease.generation)
    || BigInt(lease.generation) > BigInt("9223372036854775807")) {
    throw new MatterSyncLeaseLostError();
  }
  return { p_account_scope: lease.accountScope, p_owner: lease.owner, p_generation: lease.generation };
}
