import { PageShell } from "../_components/page-shell";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { getTagRanking, normalizeTagPeriod } from "@/lib/tags-service";
import { TagsRanking } from "./tags-ranking";

type TagsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TagsPage({ searchParams }: TagsPageProps) {
  const params = await searchParams;
  const period = normalizeTagPeriod(params?.period);
  const client = getSupabaseAdminClient();
  const rankingResult = await getTagsPageData(client, period);

  return (
    <PageShell
      eyebrow="Tags"
      title="Tag trends"
      description="Explore Matter topics by reading time, article count, words read, and highlights."
    >
      {rankingResult.ok ? (
        <TagsRanking period={period} ranking={rankingResult.ranking} />
      ) : (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
          {rankingResult.message}
        </div>
      )}
    </PageShell>
  );
}

async function getTagsPageData(client: ReturnType<typeof getSupabaseAdminClient>, period: ReturnType<typeof normalizeTagPeriod>) {
  try {
    const ranking = await getTagRanking(client, { preset: period });
    return { ok: true as const, ranking };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load tag analytics.";
    return { ok: false as const, message };
  }
}
