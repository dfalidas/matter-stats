import { SyncStatusPanel } from "@/components/sync-status";
import { loadSyncStatus, unavailableSyncStatus } from "@/lib/sync-status";
import { PageShell } from "../_components/page-shell";
import { DashboardOverview } from "./dashboard-overview";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireAccessSession } from "@/lib/require-auth";
import { getDefaultMetricsTimezone, METRICS_PERIOD_PRESETS, type MetricsPeriodPreset } from "@/lib/metrics-service";
import { getOverviewReadingMetrics, toOverviewClientPayload, loadOverviewLibrary } from "@/lib/overview-service";
import { validateCustomRange } from "@/lib/custom-range";

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
  const customRequested = params?.start !== undefined || params?.end !== undefined;
  const validation = customRequested ? validateCustomRange(start, end) : null;
  if (validation && !validation.ok) {
    return (
      <PageShell eyebrow="Overview" title="A quieter view of your reading" description="Choose a valid custom analytics period.">
        <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-5" action="/dashboard">
          <label className="grid gap-1 text-sm">From<input required name="start" type="date" defaultValue={start ?? ""} className="min-h-11 rounded-lg border px-3" /></label>
          <label className="grid gap-1 text-sm">Through<input required name="end" type="date" defaultValue={end ?? ""} className="min-h-11 rounded-lg border px-3" /></label>
          <button className="min-h-11 rounded-lg bg-foreground px-4 text-sm text-background">Apply dates</button>
          <p role="alert" className="w-full text-sm text-destructive">{validation.message}</p>
        </form>
      </PageShell>
    );
  }
  const now = new Date();
  const timezone = getDefaultMetricsTimezone();
  const statusRead = (async () => {
    try { return await loadSyncStatus(getSupabaseAdminClient(), now, timezone); }
    catch { return unavailableSyncStatus(now, timezone); }
  })();
  const [metricsResult, status] = await Promise.all([getDashboardMetrics(period, start, end, now, timezone), statusRead]);

  return (
    <PageShell
      eyebrow="Overview"
      title="A quieter view of your reading"
      description="Reliable time-based insights from your synced Matter reading sessions."
    >
      <SyncStatusPanel view={status.view} />
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

async function getDashboardMetrics(period: MetricsPeriodPreset, start: string | null, end: string | null, now: Date, timezone: string) {
  try {
    const client = getSupabaseAdminClient();
    const [overviewMetrics, library] = await Promise.all([
      getOverviewReadingMetrics(client, period, start, end, now, timezone)
        .then(value => ({ ok: true as const, value }))
        .catch(() => ({ ok: false as const })),
      loadOverviewLibrary(client),
    ]);
    if (!overviewMetrics.ok) return { ok: false as const, message: "Reading metrics query unavailable. No zero totals have been substituted.", library };
    return { ok: true as const, ...toOverviewClientPayload(overviewMetrics.value), library };
  } catch {
    return { ok: false as const, message: "Reading metrics query unavailable. Retry this page.", library: { state: "unavailable" as const } };
  }
}
export const maxDuration = 180;
