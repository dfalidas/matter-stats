import { PageShell } from "../_components/page-shell";
import { ArticlesLibrary } from "./articles-library";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { getArticleList, normalizeArticlePage, normalizeArticlePeriod, normalizeArticleTextFilter } from "@/lib/articles-service";

export const dynamic = "force-dynamic";

type ArticlesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ArticlesPage({ searchParams }: ArticlesPageProps) {
  const params = await searchParams;
  const client = getSupabaseAdminClient();
  const result = await getArticlesPageData(client, {
    period: normalizeArticlePeriod(params?.period),
    query: normalizeArticleTextFilter(params?.q),
    source: normalizeArticleTextFilter(params?.source),
    tag: normalizeArticleTextFilter(params?.tag),
    page: normalizeArticlePage(params?.page),
  });

  return (
    <PageShell
      eyebrow="Articles"
      title="Article library"
      description="Browse your Matter history with fast server-side search, focused filters, highlight counts, and reading metadata."
    >
      {result.ok ? (
        <ArticlesLibrary result={result.result} />
      ) : (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
          {result.message}
        </div>
      )}
    </PageShell>
  );
}

async function getArticlesPageData(client: ReturnType<typeof getSupabaseAdminClient>, filters: Parameters<typeof getArticleList>[1]) {
  try {
    const result = await getArticleList(client, filters);
    return { ok: true as const, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load articles.";
    return { ok: false as const, message };
  }
}
