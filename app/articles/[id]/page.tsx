import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, Clock, ExternalLink, Highlighter, Tags } from "lucide-react";

import { PageShell } from "../../_components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getArticleDetail } from "@/lib/articles-service";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ArticleDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ArticleDetailPage({ params }: ArticleDetailPageProps) {
  const { id } = await params;
  const client = getSupabaseAdminClient();
  const article = await getArticleDetail(client, decodeURIComponent(id));

  if (!article) {
    notFound();
  }

  const totalSessionSeconds = article.sessions.reduce((total, session) => total + (session.duration_seconds ?? 0), 0);
  const totalSessionWords = article.sessions.reduce((total, session) => total + (session.words_estimated ?? 0), 0);

  return (
    <PageShell
      eyebrow="Article detail"
      title={article.title ?? "Untitled article"}
      description={[article.source, article.author, formatDate(article.created_at_matter ?? article.updated_at_matter)].filter(Boolean).join(" • ")}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/articles">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to articles
            </Link>
          </Button>
          {article.url ? (
            <Button asChild size="sm">
              <a href={article.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" aria-hidden />
                Open original
              </a>
            </Button>
          ) : null}
        </div>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Reading time" value={formatMinutes(article.estimated_reading_time_minutes ?? Math.round(totalSessionSeconds / 60))} icon={Clock} />
          <StatCard label="Word count" value={formatInteger(article.word_count ?? totalSessionWords)} icon={BookOpen} />
          <StatCard label="Highlights" value={formatInteger(article.annotations.length)} icon={Highlighter} />
          <StatCard label="Tags" value={formatInteger(article.tags.length)} icon={Tags} />
        </section>

        <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
          <Card className="border-white/10 bg-background/55 shadow-soft">
            <CardHeader>
              <CardTitle>Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <MetadataRow label="Source" value={article.source} />
              <MetadataRow label="Author" value={article.author} />
              <MetadataRow label="Status" value={article.status} />
              <MetadataRow label="Saved" value={formatDate(article.created_at_matter)} />
              <MetadataRow label="Updated" value={formatDate(article.updated_at_matter)} />
              <Separator className="bg-white/10" />
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Tags</p>
                {article.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {article.tags.map((tag) => (
                      <Badge key={tag.id} variant="outline" className="rounded-full">{tag.name}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No tags synced for this article.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-background/55 shadow-soft">
            <CardHeader>
              <CardTitle>Highlights</CardTitle>
              <p className="text-sm text-muted-foreground">Synced annotations and notes from Matter.</p>
            </CardHeader>
            <CardContent>
              {article.annotations.length === 0 ? (
                <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                  No highlights have been synced for this article yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {article.annotations.map((annotation) => (
                    <article key={annotation.id} className="rounded-2xl border border-white/10 bg-background/60 p-4">
                      <p className="leading-7 text-foreground">{annotation.text ?? "Untitled highlight"}</p>
                      {annotation.note ? <p className="mt-3 rounded-xl bg-primary/10 p-3 text-sm text-primary">{annotation.note}</p> : null}
                      <p className="mt-3 text-xs text-muted-foreground">{formatDate(annotation.created_at_matter)}</p>
                    </article>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

function MetadataRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value ?? "—"}</span>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Clock }) {
  return (
    <Card className="border-white/10 bg-background/55">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      </CardContent>
    </Card>
  );
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) {
    return "—";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
