import { PageShell } from "../_components/page-shell";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { getReadingReport } from "@/lib/reports-service";

import { YearInReadingOverview } from "./year-in-reading-overview";

const FALLBACK_YEAR = new Date().getFullYear();

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
  const client = getSupabaseAdminClient();
  const recapResult = await getYearInReadingResult(client);
  const year = recapResult.ok ? getReportYear(recapResult.report) : FALLBACK_YEAR;

  return (
    <PageShell
      eyebrow="Year in Reading"
      title={`Your ${year} in Reading`}
      description="A cinematic annual recap of your Matter reading: words, articles, publications, authors, tags, topics, streaks, milestones, and momentum."
    >
      <YearInReadingOverview year={year} recapResult={recapResult} />
    </PageShell>
  );
}

async function getYearInReadingResult(
  client: ReturnType<typeof getSupabaseAdminClient>,
): Promise<YearInReadingResult> {
  try {
    const report = await getReadingReport(client, "yearly");
    return { ok: true, report };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load year-in-reading recap.";
    return { ok: false, message };
  }
}

function getReportYear(report: Awaited<ReturnType<typeof getReadingReport>>): number {
  const startYear = report.metrics.range.start?.getUTCFullYear();
  return startYear ?? FALLBACK_YEAR;
}
