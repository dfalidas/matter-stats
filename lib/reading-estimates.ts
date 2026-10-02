export const DEFAULT_READING_WPM = 225;

export function estimateWordsFromSeconds(seconds: number, wpm = DEFAULT_READING_WPM): number {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return Math.round((safeSeconds / 60) * wpm);
}

export const SESSION_LENGTH_LABELS = ["<5 min", "5–<15 min", "15–<30 min", "≥30 min"] as const;

export function sessionLengthBucket(seconds: number): (typeof SESSION_LENGTH_LABELS)[number] {
  if (seconds < 5 * 60) return "<5 min";
  if (seconds < 15 * 60) return "5–<15 min";
  if (seconds < 30 * 60) return "15–<30 min";
  return "≥30 min";
}

export function buildSessionLengthHistogram(durations: number[]) {
  const counts = new Map(SESSION_LENGTH_LABELS.map((label) => [label, 0]));
  for (const duration of durations) {
    const label = sessionLengthBucket(Math.max(0, duration));
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return SESSION_LENGTH_LABELS.map((label) => ({ label, count: counts.get(label) ?? 0 }));
}
