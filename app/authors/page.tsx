import { PageShell } from "../_components/page-shell";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { getAuthorRanking, normalizeAuthorPeriod } from "@/lib/authors-service";
import { AuthorsRanking } from "./authors-ranking";

export const dynamic = "force-dynamic";

type AuthorsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AuthorsPage({ searchParams }: AuthorsPageProps) {
  const params = await searchParams;
  const period = normalizeAuthorPeriod(params?.period);
  const client = getSupabaseAdminClient();
  const rankingResult = await getAuthorsPageData(client, period);

  return (
    <PageShell
      eyebrow="Authors"
      title="Author insights"
      description="Rank authors by reading time, article count, words read, and the publications where you spend the most time with their work."
    >
      {rankingResult.ok ? (
        <AuthorsRanking period={period} ranking={rankingResult.ranking} />
      ) : (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
          {rankingResult.message}
        </div>
      )}
    </PageShell>
  );
}

async function getAuthorsPageData(client: ReturnType<typeof getSupabaseAdminClient>, period: ReturnType<typeof normalizeAuthorPeriod>) {
  try {
    const ranking = await getAuthorRanking(client, { preset: period });
    return { ok: true as const, ranking };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load author analytics.";
    return { ok: false as const, message };
  }
}
