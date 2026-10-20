import Link from "next/link";
import { isValidReportReference } from "@/lib/reports-service";
import { PageShell } from "../_components/page-shell";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireAccessSession } from "@/lib/require-auth";
import { getReadingReport, toYearInReadingClientPayload, type YearInReadingClientPayload } from "@/lib/reports-service";
import { calendarYear, getAppTimezone, timestampToCalendarDate } from "@/lib/calendar";

import { YearInReadingOverview } from "./year-in-reading-overview";

export const dynamic = "force-dynamic";

type YearInReadingResult =
  | {
      ok: true;
      report: YearInReadingClientPayload;
    }
  | {
      ok: false;
      message: string;
    };

export default async function YearInReadingPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAccessSession();
  const now = new Date();
  const localYear = calendarYear(timestampToCalendarDate(now, getAppTimezone()));
  const client = getSupabaseAdminClient();
  const params = await searchParams;
  const candidate = Array.isArray(params?.year) ? params.year[0] : params?.year;
  const reference = isValidReportReference("yearly", candidate) ? candidate : String(localYear);
  const recapResult = await getYearInReadingResult(client, now, reference);
  const year = recapResult.ok ? getReportYear(recapResult.report) : Number(reference);

  return (
    <PageShell
      eyebrow="Year in Reading"
      title={`Your ${year} in Reading`}
      description="An annual recap of imported reading sessions, with time, estimated words, streaks and milestones. Upstream historical coverage is unverified."
    >
      <Link href={`/reports?period=yearly&date=${year}`} className="mb-5 inline-flex min-h-11 items-center text-sm text-primary">View {year} report and CSV →</Link>
      <YearInReadingOverview year={year} recapResult={recapResult} />
    </PageShell>
  );
}

async function getYearInReadingResult(
  client: ReturnType<typeof getSupabaseAdminClient>,
  now: Date,
  reference: string,
): Promise<YearInReadingResult> {
  try {
    const report = await getReadingReport(client, "yearly", { now, reference });
    return { ok: true, report: toYearInReadingClientPayload(report) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load year-in-reading recap.";
    return { ok: false, message };
  }
}

function getReportYear(report: YearInReadingClientPayload): number {
  return calendarYear(report.metrics.range.startDate!);
}
