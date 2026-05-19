import { PageShell } from "../_components/page-shell";
import { ReportsOverview } from "./reports-overview";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { getReadingReport, REPORT_PERIODS, type ReportPeriod } from "@/lib/reports-service";

const DEFAULT_REPORT_PERIOD: ReportPeriod = "weekly";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const period = normalizeReportPeriod(params?.period);
  const weekStartDate = normalizeWeekStartDate(params?.weekStart);
  const client = getSupabaseAdminClient();
  const reportsResult = await getReportsResult(client, period, weekStartDate);

  return (
    <PageShell
      eyebrow="Reports"
      title="Reading reports"
      description="Daily, weekly, monthly, and yearly summaries powered by synced Matter reading sessions from Supabase."
    >
      <ReportsOverview period={period} reportsResult={reportsResult} />
    </PageShell>
  );
}

function normalizeReportPeriod(value: string | string[] | undefined): ReportPeriod {
  const candidate = Array.isArray(value) ? value[0] : value;
  return REPORT_PERIODS.includes(candidate as ReportPeriod) ? (candidate as ReportPeriod) : DEFAULT_REPORT_PERIOD;
}

function normalizeWeekStartDate(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

async function getReportsResult(client: ReturnType<typeof getSupabaseAdminClient>, period: ReportPeriod, weekStartDate: string | null) {
  try {
    const report = await getReadingReport(client, period, { weekStartDate });
    return { ok: true as const, report };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load reading report.";
    return { ok: false as const, message };
  }
}
