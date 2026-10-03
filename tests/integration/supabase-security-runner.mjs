export async function attemptTrackedWrite(attempts, attempt, write) {
  attempts.push(attempt);
  return await write();
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
