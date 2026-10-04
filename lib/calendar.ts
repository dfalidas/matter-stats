export const DEFAULT_APP_TIMEZONE = "Europe/Athens";

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getAppTimezone(configured = process.env.APP_TIMEZONE): string {
  const timezone = configured?.trim();
  return timezone && isValidTimezone(timezone) ? timezone : DEFAULT_APP_TIMEZONE;
}

export function normalizeTimezone(timezone?: string): string {
  const value = timezone?.trim() || getAppTimezone();
  return isValidTimezone(value) ? value : DEFAULT_APP_TIMEZONE;
}

export function getLocalDateTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")), month: Number(values.get("month")), day: Number(values.get("day")),
    hour: Number(values.get("hour")), minute: Number(values.get("minute")), second: Number(values.get("second")),
    millisecond: Number(values.get("fractionalSecond") ?? 0),
  };
}

export function getLocalDateParts(date: Date, timezone: string) {
  const { year, month, day } = getLocalDateTimeParts(date, timezone);
  return { year, month, day };
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = getLocalDateTimeParts(date, timezone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond) - date.getTime();
}

export type LocalDateTime = ReturnType<typeof getLocalDateTimeParts>;

/**
 * Convert a local wall time deterministically. Repeated times choose the earlier
 * instant; gap times move forward by the transition gap (Temporal-compatible).
 */
export function localDateTimeToUtc(parts: LocalDateTime, timezone: string): Date {
  const normalizedDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    normalizedDate.getUTCFullYear() !== parts.year ||
    normalizedDate.getUTCMonth() !== parts.month - 1 ||
    normalizedDate.getUTCDate() !== parts.day ||
    parts.hour < 0 || parts.hour > 23 || parts.minute < 0 || parts.minute > 59 ||
    parts.second < 0 || parts.second > 59 || parts.millisecond < 0 || parts.millisecond > 999
  ) throw new Error("Invalid local date-time");
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 1) offsets.add(timezoneOffsetMs(new Date(wall + hours * 3_600_000), timezone));
  const candidates = [...offsets]
    .map((offset) => new Date(wall - offset))
    .filter((date) => sameLocalDateTime(getLocalDateTimeParts(date, timezone), parts))
    .sort((a, b) => a.getTime() - b.getTime());
  if (candidates[0]) return candidates[0];
  // For a spring-forward gap, the pre-transition (smaller) offset advances the wall time by the gap.
  return new Date(wall - Math.min(...offsets));
}

function sameLocalDateTime(left: LocalDateTime, right: LocalDateTime): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day &&
    left.hour === right.hour && left.minute === right.minute && left.second === right.second &&
    left.millisecond === right.millisecond;
}

/** Convert a local calendar midnight to its UTC instant. */
export function localDateToUtc(year: number, month: number, day: number, timezone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day));
  const firstPass = new Date(utcGuess.getTime() - timezoneOffsetMs(utcGuess, timezone));
  return new Date(utcGuess.getTime() - timezoneOffsetMs(firstPass, timezone));
}

/** Convert an absolute timestamp to a YYYY-MM-DD key in the analytics timezone. */
export function timestampToCalendarDate(date: Date | string, timezone = getAppTimezone()): string {
  const timestamp = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(timestamp.getTime())) throw new Error(`Invalid timestamp: ${String(date)}`);
  const { year, month, day } = getLocalDateParts(timestamp, timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return normalized.getUTCFullYear() === year && normalized.getUTCMonth() === month - 1 && normalized.getUTCDate() === day;
}

/** Calendar-key arithmetic deliberately uses UTC so it is independent of process timezone and DST. */
export function addCalendarDays(value: string, days: number): string {
  if (!isCalendarDate(value)) throw new Error(`Invalid calendar date: ${value}`);
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

export function calendarDateToUtc(value: string, timezone = getAppTimezone()): Date {
  if (!isCalendarDate(value)) throw new Error(`Invalid calendar date: ${value}`);
  const [year, month, day] = value.split("-").map(Number);
  return localDateToUtc(year, month, day, timezone);
}

export function calendarDayBounds(value: string, timezone = getAppTimezone()) {
  return { start: calendarDateToUtc(value, timezone), end: calendarDateToUtc(addCalendarDays(value, 1), timezone) };
}

export function addLocalDays(date: Date, days: number, timezone: string): Date {
  return calendarDateToUtc(addCalendarDays(timestampToCalendarDate(date, timezone), days), timezone);
}

export function formatCalendarDate(value: string, options: Intl.DateTimeFormatOptions, locale = "en-GB"): string {
  if (!isCalendarDate(value)) throw new Error(`Invalid calendar date: ${value}`);
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(`${value}T12:00:00.000Z`));
}

export function calendarYear(value: string): number {
  if (!isCalendarDate(value)) throw new Error(`Invalid calendar date: ${value}`);
  return Number(value.slice(0, 4));
}
