import { PageShell } from "../_components/page-shell";
import { DashboardOverview } from "./dashboard-overview";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireAccessSession } from "@/lib/require-auth";
import { getReadingMetrics, METRICS_PERIOD_PRESETS, type MetricsPeriodPreset } from "@/lib/metrics-service";

const DEFAULT_PERIOD: MetricsPeriodPreset = "week";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  await requireAccessSession();
  const params = await searchParams;
  const period = normalizePeriod(params?.period);
  const metricsResult = await getDashboardMetrics(period);

  return (
    <PageShell
      eyebrow="Overview"
      title="A quieter view of your reading"
      description="Reliable time-based insights from your synced Matter reading sessions."
    >
      <DashboardOverview period={period} metricsResult={metricsResult} />
    </PageShell>
  );
}

function normalizePeriod(value: string | string[] | undefined): MetricsPeriodPreset {
  const candidate = Array.isArray(value) ? value[0] : value;
  return METRICS_PERIOD_PRESETS.includes(candidate as MetricsPeriodPreset) ? (candidate as MetricsPeriodPreset) : DEFAULT_PERIOD;
}

async function getDashboardMetrics(period: MetricsPeriodPreset) {
  try {
    const client = getSupabaseAdminClient();
    const [metrics, todayMetrics, allTimeMetrics] = await Promise.all([
      getReadingMetrics(client, { preset: period, topLimit: 5, recentLimit: 6 }),
      getReadingMetrics(client, { preset: "today", topLimit: 5, recentLimit: 6 }),
      getReadingMetrics(client, { preset: "all-time", topLimit: 5, recentLimit: 6 }),
    ]);

    return { ok: true as const, metrics, todayMetrics, allTimeMetrics };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load dashboard metrics.";
    return { ok: false as const, message };
  }
}
