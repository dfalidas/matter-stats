export async function attemptTrackedWrite(attempts, attempt, write) {
  attempts.push(attempt);
  return await write();
}

export function isMigrationSeededStream(row, stream) {
  const expectedFilters = stream === "recent_sessions" ? {} : { status: "all", order: "updated" };
  return row?.stream === stream
    && row.endpoint === (stream === "recent_sessions" ? "/reading_sessions" : "/items")
    && JSON.stringify(row.filters) === JSON.stringify(expectedFilters)
    && row.page_limit === 25
    && row.cursor === null
    && row.cycle_started_at === null
    && row.cycle_generation === 0
    && row.completed_watermark === null
    && row.cycle_active === false
    && row.transition_status === "legacy_recoverable_restart"
    && (stream !== "recent_sessions" || row.coverage_window === "current_year");
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
