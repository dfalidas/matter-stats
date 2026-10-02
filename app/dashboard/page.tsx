import { PageShell } from "../_components/page-shell";
import { DashboardOverview } from "./dashboard-overview";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireAccessSession } from "@/lib/require-auth";
import { getReadingMetrics, localDateToUtc, METRICS_PERIOD_PRESETS, type MetricsPeriodPreset } from "@/lib/metrics-service";
import type { MatterItem } from "@/lib/supabase-types";

const DEFAULT_PERIOD: MetricsPeriodPreset = "week";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  await requireAccessSession();
  const params = await searchParams;
  const period = normalizePeriod(params?.period);
  const start = normalizeDate(params?.start);
  const end = normalizeDate(params?.end);
  const metricsResult = await getDashboardMetrics(period, start, end);

  return (
    <PageShell
      eyebrow="Overview"
      title="A quieter view of your reading"
      description="Reliable time-based insights from your synced Matter reading sessions."
    >
      <DashboardOverview period={start && end ? "custom" : period} metricsResult={metricsResult} />
    </PageShell>
  );
}

function normalizeDate(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const [year, month, day] = candidate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? candidate : null;
}

function normalizePeriod(value: string | string[] | undefined): MetricsPeriodPreset {
  const candidate = Array.isArray(value) ? value[0] : value;
  return METRICS_PERIOD_PRESETS.includes(candidate as MetricsPeriodPreset) ? (candidate as MetricsPeriodPreset) : DEFAULT_PERIOD;
}

async function getDashboardMetrics(period: MetricsPeriodPreset, start: string | null, end: string | null) {
  try {
    const client = getSupabaseAdminClient();
    const range = start && end && start <= end ? {
      start: localDateToUtc(...dateParts(start), "Europe/Athens"),
      end: localDateToUtc(...addOneDay(end), "Europe/Athens"),
    } : null;
    const [metrics, todayMetrics, allTimeMetrics, library] = await Promise.all([
      getReadingMetrics(client, range ? { range, topLimit: 5, recentLimit: 6 } : { preset: period, topLimit: 5, recentLimit: 6 }),
      getReadingMetrics(client, { preset: "today", topLimit: 5, recentLimit: 6 }),
      getReadingMetrics(client, { preset: "all-time", topLimit: 5, recentLimit: 6 }),
      client.from("matter_items").select("id,title,source,author,word_count,estimated_reading_time_minutes,progress,status").order("updated_at", { ascending: false }).limit(4),
    ]);
    return { ok: true as const, metrics, todayMetrics, allTimeMetrics, library: (library.data ?? []) as Pick<MatterItem, "id" | "title" | "source" | "author" | "word_count" | "estimated_reading_time_minutes" | "progress" | "status">[] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load dashboard metrics.";
    return { ok: false as const, message };
  }
}

function dateParts(value: string): [number, number, number] {
  const [year, month, day] = value.split("-").map(Number);
  return [year, month, day];
}

function addOneDay(value: string): [number, number, number] {
  const [year, month, day] = dateParts(value);
  return [year, month, day + 1];
}
