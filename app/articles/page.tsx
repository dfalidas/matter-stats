import { getDefaultMetricsTimezone } from "@/lib/metrics-service";
import Link from "next/link";
import { PageShell } from "../_components/page-shell";
import { ArticlesLibrary } from "./articles-library";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireAccessSession } from "@/lib/require-auth";
import { getArticleList, normalizeArticlePage, normalizeArticleTextFilter } from "@/lib/articles-service";

export const dynamic = "force-dynamic";

type ArticlesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ArticlesPage({ searchParams }: ArticlesPageProps) {
  await requireAccessSession();
  const params = await searchParams;
  const client = getSupabaseAdminClient();
  const result = await getArticlesPageData(client, {
    period: "all-time",
    query: normalizeArticleTextFilter(params?.q),
    source: normalizeArticleTextFilter(params?.source),
    tag: normalizeArticleTextFilter(params?.tag),
    status: normalizeArticleTextFilter(params?.status) || "all",
    author: normalizeArticleTextFilter(params?.author),
    contentType: normalizeArticleTextFilter(params?.type),
    size: normalizeArticleTextFilter(params?.size),
    page: normalizeArticlePage(params?.page),
  });

  return (
    <PageShell
      eyebrow="Library"
      title="Your library"
      description="Browse current Matter items. Library metadata and progress are independent of the analytics period."
    >
      <nav aria-label="Library insights" className="mb-5 flex flex-wrap gap-4 text-sm text-primary"><Link className="inline-flex min-h-11 items-center" href="/authors">Author reading attribution</Link><Link className="inline-flex min-h-11 items-center" href="/sources">Source reading attribution</Link><Link className="inline-flex min-h-11 items-center" href="/tags">Tag reading attribution</Link></nav>
      {result.ok ? (
        <ArticlesLibrary result={result.result} timezone={getDefaultMetricsTimezone()} />
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
    void error;
    const message = "Library data is unavailable. Reload this page to try again.";
    return { ok: false as const, message };
  }
}
