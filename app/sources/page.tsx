import { PageShell } from "../_components/page-shell";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { getSourceRanking, normalizeSourcePeriod } from "@/lib/sources-service";
import { SourcesRanking } from "./sources-ranking";

type SourcesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SourcesPage({ searchParams }: SourcesPageProps) {
  const params = await searchParams;
  const period = normalizeSourcePeriod(params?.period);
  const client = getSupabaseAdminClient();
  const rankingResult = await getSourcesPageData(client, period);

  return (
    <PageShell
      eyebrow="Sources"
      title="Source analytics"
      description="Rank publications and source domains by reading time, words, articles, highlights, and share of your attention."
    >
      {rankingResult.ok ? (
        <SourcesRanking period={period} ranking={rankingResult.ranking} />
      ) : (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
          {rankingResult.message}
        </div>
      )}
    </PageShell>
  );
}

async function getSourcesPageData(client: ReturnType<typeof getSupabaseAdminClient>, period: ReturnType<typeof normalizeSourcePeriod>) {
  try {
    const ranking = await getSourceRanking(client, { preset: period });
    return { ok: true as const, ranking };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load source analytics.";
    return { ok: false as const, message };
  }
}
