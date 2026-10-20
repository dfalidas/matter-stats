import { PageShell } from "../_components/page-shell";
import { ReportsOverview } from "./reports-overview";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireAccessSession } from "@/lib/require-auth";
import {
  getReadingReport,
  toReportsClientPayload,
  isValidReportReference,
  REPORT_PERIODS,
  type ReportPeriod,
} from "@/lib/reports-service";
import { timestampToCalendarDate } from "@/lib/calendar";

const DEFAULT_REPORT_PERIOD: ReportPeriod = "weekly";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  await requireAccessSession();
  const params = await searchParams;
  const period = normalizeReportPeriod(params?.period);
  // Retain the validated calendar selection separately from Monday/month/year
  // aggregation boundaries. Use the service's local-today fallback for invalid
  // or absent references, including when the report query is unavailable.
  const today = timestampToCalendarDate(new Date());
  const reference =
    normalizeReference(period, params?.date ?? params?.weekStart) ??
    (period === "yearly"
      ? today.slice(0, 4)
      : period === "monthly"
        ? today.slice(0, 7)
        : today);
  const client = getSupabaseAdminClient();
  const reportsResult = await getReportsResult(client, period, reference);

  return (
    <PageShell
      eyebrow="Reports"
      title="Reading reports"
      description="Weekly, monthly, and yearly reviews built from synced session duration—not inferred article activity."
    >
      <ReportsOverview
        period={period}
        reference={reference}
        reportsResult={reportsResult}
      />
    </PageShell>
  );
}

function normalizeReportPeriod(value: string | string[] | undefined): ReportPeriod {
  const candidate = Array.isArray(value) ? value[0] : value;
  return REPORT_PERIODS.includes(candidate as ReportPeriod) ? (candidate as ReportPeriod) : DEFAULT_REPORT_PERIOD;
}

function normalizeReference(period: ReportPeriod, value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isValidReportReference(period, candidate) ? candidate : null;
}

async function getReportsResult(client: ReturnType<typeof getSupabaseAdminClient>, period: ReportPeriod, reference: string | null) {
  try {
    const report = await getReadingReport(client, period, { reference });
    return { ok: true as const, report: toReportsClientPayload(report) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load reading report.";
    return { ok: false as const, message };
  }
}
