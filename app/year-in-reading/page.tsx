import { PageShell } from "../_components/page-shell";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireAccessSession } from "@/lib/require-auth";
import { getReadingReport } from "@/lib/reports-service";
import { calendarYear, getAppTimezone, timestampToCalendarDate } from "@/lib/calendar";

import { YearInReadingOverview } from "./year-in-reading-overview";

export const dynamic = "force-dynamic";

type YearInReadingResult =
  | {
      ok: true;
      report: Awaited<ReturnType<typeof getReadingReport>>;
    }
  | {
      ok: false;
      message: string;
    };

export default async function YearInReadingPage() {
  await requireAccessSession();
  const now = new Date();
  const localYear = calendarYear(timestampToCalendarDate(now, getAppTimezone()));
  const client = getSupabaseAdminClient();
  const recapResult = await getYearInReadingResult(client, now);
  const year = recapResult.ok ? getReportYear(recapResult.report) : localYear;

  return (
    <PageShell
      eyebrow="Year in Reading"
      title={`Your ${year} in Reading`}
      description="A cinematic annual recap of your Matter reading: estimated words, articles, publications, authors, tags, topics, streaks, milestones, and momentum."
    >
      <YearInReadingOverview year={year} recapResult={recapResult} />
    </PageShell>
  );
}

async function getYearInReadingResult(
  client: ReturnType<typeof getSupabaseAdminClient>,
  now: Date,
): Promise<YearInReadingResult> {
  try {
    const report = await getReadingReport(client, "yearly", { now });
    return { ok: true, report };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load year-in-reading recap.";
    return { ok: false, message };
  }
}

function getReportYear(report: Awaited<ReturnType<typeof getReadingReport>>): number {
  return calendarYear(report.metrics.range.startDate!);
}
