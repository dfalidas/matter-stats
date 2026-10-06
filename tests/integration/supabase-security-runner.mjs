export async function attemptTrackedWrite(attempts, attempt, write) {
  attempts.push(attempt);
  return await write();
}

export function createMatterSyncStreamFixture({ prefix, timestamp }) {
  const ownershipCursor = `${prefix}-stream-cursor`;
  const deniedOwnershipCursor = `${prefix}-browser-insert-cursor`;
  return {
    table: "matter_sync_streams",
    row: {
      stream: "recent_sessions", endpoint: "/reading_sessions", filters: { since: timestamp },
      page_limit: 25, cursor: ownershipCursor, cycle_started_at: timestamp,
      cycle_active: true, transition_status: "native", coverage_window: "current_year",
    },
    deniedRow: {
      stream: "recent_sessions", endpoint: "/reading_sessions", filters: {}, page_limit: 25,
      cursor: deniedOwnershipCursor, cycle_started_at: timestamp, cycle_active: true,
      transition_status: "native", coverage_window: "current_year",
    },
    selector: { stream: "recent_sessions" },
    update: { cycle_generation: 1 }, field: "cycle_generation", expected: 1,
    delayedInsert: true,
    ownership: { cursor: ownershipCursor },
  };
}

export function createTrackedFixtureWrite(fixture, row, label, selector) {
  // Stream fixtures share a fixed primary key, so ownership must describe the
  // row actually attempted (positive or browser-denial), not the other fixture.
  const ownership = fixture.table === "matter_sync_streams" && typeof row.cursor === "string"
    ? { cursor: row.cursor }
    : fixture.ownership ?? selector;
  return {
    label,
    fixture,
    selector,
    owns: (stored) => Object.entries(ownership).every(([column, value]) => stored[column] === value),
  };
}

export function isMigrationSeededStream(row, stream) {
  const expectedFilters = stream === "recent_sessions" ? {} : { status: "all", order: "updated" };
  return row?.stream === stream
    && row.endpoint === (stream === "recent_sessions" ? "/reading_sessions" : "/items")
    && isDeepStrictEqual(row.filters, expectedFilters)
    && row.page_limit === 25
    && row.cursor === null
    && row.cycle_started_at === null
    && row.cycle_generation === 0
    && row.completed_watermark === null
    && row.cycle_active === false
    && row.transition_status === "legacy_recoverable_restart"
    && (stream !== "recent_sessions" || row.coverage_window === "current_year");
}

export async function restoreMigrationSeed(seed, { inspect, insert }) {
  const collision = await inspect();
  if (collision?.error) throw collision.error;
  if (collision?.data != null) throw new Error("refusing to overwrite stream while restoring migration seed");
  const inserted = await insert(seed);
  if (inserted?.error) throw inserted.error;
  const restored = await inspect();
  if (restored?.error) throw restored.error;
  if (!isMigrationSeededStream(restored?.data, seed.stream)) throw new Error("migration seed restoration readback failed");
  return { error: null };
}

export async function cleanupTrackedWrites(attempts, { inspect, remove }) {
  const failures = [];
  for (const attempt of [...attempts].reverse()) {
    try {
      const inspected = await inspect(attempt);
      if (inspected?.error) throw inspected.error;
      if (inspected?.data == null) continue;
      if (!attempt.owns(inspected.data)) {
        throw new Error("ownership could not be established; refusing to delete");
      }
      const removed = await remove(attempt);
      if (removed?.error) throw removed.error;
      const verified = await inspect(attempt);
      if (verified?.error) throw verified.error;
      if (verified?.data != null && attempt.owns(verified.data)) {
        throw new Error("owned resource remained after cleanup");
      }
    } catch (error) {
      failures.push(new Error(`${attempt.label}: ${error?.code ?? error?.name ?? "error"} ${error?.message ?? "cleanup failed"}`));
    }
  }
  return failures;
}

export async function verifyLimiterGroups(groups) {
  const results = await Promise.allSettled(groups.map(async ({ label, requests, readStoredCount }) => {
    const calls = await Promise.allSettled(requests);
    const failures = calls
      .map((call, index) => call.status === "rejected" ? new Error(`${label} RPC ${index + 1}: ${call.reason?.message ?? call.reason}`) : null)
      .filter(Boolean);
    const responses = calls.filter(({ status }) => status === "fulfilled").map(({ value }) => value);
    for (const [index, response] of responses.entries()) {
      if (response?.error) failures.push(new Error(`${label} RPC ${index + 1}: ${response.error.message ?? "RPC error"}`));
      else if (typeof response?.data !== "boolean") failures.push(new TypeError(`${label} RPC ${index + 1} must return a boolean`));
    }
    if (responses.filter(({ data, error }) => !error && data === true).length !== 5) failures.push(new Error(`${label} must return true exactly five times`));
    if (responses.filter(({ data, error }) => !error && data === false).length !== 15) failures.push(new Error(`${label} must return false exactly fifteen times`));

    try {
      const stored = await readStoredCount();
      if (stored?.error) failures.push(new Error(`${label} stored-count readback: ${stored.error.message ?? "query error"}`));
      else if (stored?.count !== 5) failures.push(new Error(`${label} must store exactly five attempts`));
    } catch (error) {
      failures.push(new Error(`${label} stored-count readback: ${error?.message ?? error}`));
    }
    if (failures.length) throw new AggregateError(failures, `${label} failed ${failures.length} check(s)`);
  }));

  const failures = results.filter(({ status }) => status === "rejected").map(({ reason }) => reason);
  if (failures.length) {
    const details = failures.map((failure) => failure?.errors?.map((error) => error.message).join(", ") || failure?.message || failure).join("; ");
    throw new AggregateError(failures, `Limiter verification failed for ${failures.length} group(s): ${details}`);
  }
}
import { isDeepStrictEqual } from "node:util";
