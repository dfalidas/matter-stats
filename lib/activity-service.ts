import type { MatterStatsSupabaseClient } from "./supabase-queries";
import { estimateWordsFromSeconds } from "./reading-estimates";
import {
  formatDateInTimezone,
  getDefaultMetricsTimezone,
  localDateToUtc,
} from "./metrics-service";

const DATABASE_PAGE_SIZE = 500;
const SESSION_PAGE_SIZE = 20;

type SessionRow = {
  id: string;
  started_at: string | null;
  duration_seconds: number | null;
};

export type ActivitySession = {
  id: string;
  timestamp: string;
  durationSeconds: number;
  estimatedWords: number;
};

export function isCalendarMonth(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12;
}

export function isCalendarDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

export function normalizeActivityPage(value: string | null | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export async function getActivityMonth(
  client: MatterStatsSupabaseClient,
  requestedMonth: string,
  requestedDay: string | null,
  page = 1,
  now = new Date(),
) {
  const timezone = getDefaultMetricsTimezone();
  const today = formatDateInTimezone(now, timezone);
  const month = isCalendarMonth(requestedMonth) ? requestedMonth : today.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const start = localDateToUtc(year, monthNumber, 1, timezone);
  const end = localDateToUtc(year, monthNumber + 1, 1, timezone);
  const rows = await fetchAllSessions(client, start, end);
  const days = new Map<string, { seconds: number; estimatedWords: number; sessions: number }>();

  for (const row of rows) {
    if (!row.started_at) continue;
    const date = formatDateInTimezone(new Date(row.started_at), timezone);
    const value = days.get(date) ?? { seconds: 0, estimatedWords: 0, sessions: 0 };
    value.seconds += positiveSeconds(row.duration_seconds);
    value.estimatedWords += estimateWordsFromSeconds(positiveSeconds(row.duration_seconds));
    value.sessions += 1;
    days.set(date, value);
  }

  const selectedDay = isCalendarDate(requestedDay) && requestedDay.startsWith(`${month}-`)
    ? requestedDay
    : today.startsWith(`${month}-`)
      ? today
      : `${month}-01`;
  const selectedRows = rows.filter(
    (row) => row.started_at && formatDateInTimezone(new Date(row.started_at), timezone) === selectedDay,
  );
  const normalizedPage = Math.min(Math.max(1, Math.trunc(page)), Math.max(1, Math.ceil(selectedRows.length / SESSION_PAGE_SIZE)));
  const daySeconds = selectedRows.reduce((total, row) => total + positiveSeconds(row.duration_seconds), 0);
  const dayWords = selectedRows.reduce(
    (total, row) => total + estimateWordsFromSeconds(positiveSeconds(row.duration_seconds)),
    0,
  );

  return {
    month,
    today,
    timezone,
    selectedDay,
    days: [...days].map(([date, value]) => ({
      date,
      ...value,
    })),
    dayTotal: {
      seconds: daySeconds,
      estimatedWords: dayWords,
      sessions: selectedRows.length,
    },
    sessions: selectedRows
      .slice((normalizedPage - 1) * SESSION_PAGE_SIZE, normalizedPage * SESSION_PAGE_SIZE)
      .map((row) => ({
        id: row.id,
        timestamp: row.started_at!,
        durationSeconds: positiveSeconds(row.duration_seconds),
        estimatedWords: estimateWordsFromSeconds(positiveSeconds(row.duration_seconds)),
      })),
    page: normalizedPage,
    totalPages: Math.max(1, Math.ceil(selectedRows.length / SESSION_PAGE_SIZE)),
  };
}

async function fetchAllSessions(client: MatterStatsSupabaseClient, start: Date, end: Date): Promise<SessionRow[]> {
  const rows: SessionRow[] = [];
  for (let from = 0; ; from += DATABASE_PAGE_SIZE) {
    const { data, error } = await client
      .from("reading_sessions")
      .select("id,started_at,duration_seconds")
      .gte("started_at", start.toISOString())
      .lt("started_at", end.toISOString())
      .order("started_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + DATABASE_PAGE_SIZE - 1);
    if (error) throw error;
    const result = (data ?? []) as SessionRow[];
    rows.push(...result);
    if (result.length < DATABASE_PAGE_SIZE) return rows;
  }
}

function positiveSeconds(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}
