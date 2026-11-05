import { addCalendarDays, calendarDateToUtc, timestampToCalendarDate } from "./calendar";

export const GOAL_TIMEZONE = "Europe/Athens";
export type GoalType = "weekly" | "yearly";
export type GoalPeriod = ReturnType<typeof currentGoalPeriod>;
export type ReadingGoal = { type: GoalType; period_start: string; target_seconds: number; enabled: boolean };

export function currentGoalPeriod(type: GoalType, now: Date) {
  const today = timestampToCalendarDate(now, GOAL_TIMEZONE);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const start = type === "weekly" ? addCalendarDays(today, -((weekday + 6) % 7)) : `${today.slice(0, 4)}-01-01`;
  const end = type === "weekly" ? addCalendarDays(start, 7) : `${Number(today.slice(0, 4)) + 1}-01-01`;
  return { type, start, end, startUtc: calendarDateToUtc(start, GOAL_TIMEZONE), endUtc: calendarDateToUtc(end, GOAL_TIMEZONE) };
}

/** Decimal text -> integer hundredths -> exact integer seconds; never round input. */
export function parseGoalHours(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  const seconds = hundredths * 36;
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

export function remainingCalendarDays(period: GoalPeriod, now: Date): number {
  if (now >= period.endUtc) return 0;
  const time = now < period.startUtc ? period.startUtc : now;
  const today = timestampToCalendarDate(time, GOAL_TIMEZONE);
  const dayStart = calendarDateToUtc(today, GOAL_TIMEZONE).getTime();
  const dayEnd = calendarDateToUtc(addCalendarDays(today, 1), GOAL_TIMEZONE).getTime();
  const days = (Date.parse(period.end) - Date.parse(today)) / 86_400_000;
  return Math.max(0, days - (time.getTime() - dayStart) / (dayEnd - dayStart));
}

export function goalProgress(targetSeconds: number, actualSeconds: number, period: GoalPeriod, now: Date) {
  const remainingSeconds = Math.max(0, targetSeconds - actualSeconds);
  const days = remainingCalendarDays(period, now);
  return {
    actualSeconds, remainingSeconds, percent: actualSeconds / targetSeconds * 100,
    barPercent: Math.min(100, Math.max(0, actualSeconds / targetSeconds * 100)),
    requiredSecondsPerDay: days > 0 ? remainingSeconds / days : 0,
    ended: now >= period.endUtc,
  };
}
