import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  Highlighter,
  LinkIcon,
  Tags,
  Timer,
} from "lucide-react";

import { PageShell } from "../../_components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  const wordCount = article.word_count ?? totalSessionWords;
  const completion = resolveCompletionPercent(article.progress, article.status, wordCount, totalSessionWords);
  const articleDate = article.created_at_matter ?? article.updated_at_matter;

  return (
    <PageShell
      eyebrow="Article detail"
      title={article.title ?? "Untitled article"}
      description={[article.source, article.author, formatDate(articleDate)].filter(Boolean).join(" • ")}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/articles">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to Articles
            </Link>
          </Button>
          {article.url ? (
            <Button asChild size="sm">
              <a href={article.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" aria-hidden />
                Open Original
              </a>
            </Button>
          ) : null}
        </div>

        <Card className="border-white/10 bg-background/55 shadow-soft">
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm md:grid-cols-2">
            <MetadataRow label="Source" value={article.source} />
            <MetadataRow label="Author" value={article.author} />
            <MetadataRow label="Date" value={formatDate(articleDate)} />
            <MetadataRow label="Original URL" value={article.url} href={article.url} />
          </CardContent>
        </Card>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Time Spent" value={formatDuration(totalSessionSeconds)} icon={Timer} />
          <StatCard label="Words" value={formatInteger(wordCount)} icon={BookOpen} />
          <StatCard label="Highlights" value={formatInteger(article.annotations.length)} icon={Highlighter} />
          <StatCard label="Completion" value={completion === null ? "—" : formatPercent(completion)} icon={CheckCircle2} />
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5">
            <Card className="border-white/10 bg-background/55 shadow-soft">
              <CardHeader>
                <CardTitle>Reading Sessions</CardTitle>
                <p className="text-sm text-muted-foreground">Session history synced from Matter for this article.</p>
              </CardHeader>
              <CardContent>
                {article.sessions.length === 0 ? (
                  <EmptyState icon={Clock} message="No reading sessions have been synced for this article yet." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Date</TableHead>
                        <TableHead>Started time</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                        <TableHead className="text-right">Progress</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {article.sessions.map((session) => {
                        const sessionProgress = resolveSessionProgressPercent(session.words_estimated, wordCount);

                        return (
                          <TableRow key={session.id}>
                            <TableCell>
                              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                                {formatDate(session.started_at)}
                              </span>
                            </TableCell>
                            <TableCell>{formatTime(session.started_at)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatDuration(session.duration_seconds ?? 0)}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {sessionProgress === null ? "—" : `${formatPercent(sessionProgress)} · ${formatInteger(session.words_estimated ?? 0)} words`}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-background/55 shadow-soft">
              <CardHeader>
                <CardTitle>Highlights</CardTitle>
                <p className="text-sm text-muted-foreground">Synced annotations and notes from Matter.</p>
              </CardHeader>
              <CardContent>
                {article.annotations.length === 0 ? (
                  <EmptyState icon={Highlighter} message="No highlights have been synced for this article yet. Highlights you add in Matter will appear here after the next sync." />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
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

          <aside className="space-y-5">
            <Card className="border-white/10 bg-background/55 shadow-soft">
              <CardHeader>
                <CardTitle>Article Insights</CardTitle>
                <p className="text-sm text-muted-foreground">Source, topics, estimate, and source-relative performance.</p>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <InsightRow label="Source" value={article.source ?? "—"} />
                <InsightRow label="Estimated reading time" value={formatMinutes(article.estimated_reading_time_minutes ?? Math.round(wordCount / 250))} />
                <InsightRow label="Performance vs average" value={formatPerformance(article.sourcePerformance?.percentVsAverage ?? null)} />
                {article.sourcePerformance ? (
                  <p className="rounded-2xl border border-white/10 bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
                    You spent {formatDuration(article.sourcePerformance.articleTimeSeconds)} on this article. The average for {article.sourcePerformance.sourceArticleCount} {article.sourcePerformance.source} article{article.sourcePerformance.sourceArticleCount === 1 ? "" : "s"} is {formatDuration(article.sourcePerformance.sourceAverageTimeSeconds)}.
                  </p>
                ) : null}
                <Separator className="bg-white/10" />
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Topic tags</p>
                  {article.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {article.tags.map((tag) => (
                        <Badge key={tag.id} variant="outline" className="rounded-full">
                          <Tags className="mr-1 h-3 w-3" aria-hidden />
                          {tag.name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No topic tags synced for this article.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-background/55 shadow-soft">
              <CardHeader>
                <CardTitle>Related Articles</CardTitle>
                <p className="text-sm text-muted-foreground">More articles from {article.source ?? "the same source"}.</p>
              </CardHeader>
              <CardContent>
                {article.relatedArticles.length === 0 ? (
                  <EmptyState icon={LinkIcon} message="No related articles from this source have been synced yet." compact />
                ) : (
                  <div className="space-y-3">
                    {article.relatedArticles.map((relatedArticle) => (
                      <Link
                        key={relatedArticle.id}
                        href={`/articles/${encodeURIComponent(relatedArticle.id)}`}
                        className="block rounded-2xl border border-white/10 bg-background/60 p-4 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                      >
                        <p className="font-medium leading-6 text-foreground">{relatedArticle.title ?? "Untitled article"}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {[relatedArticle.author, formatDate(relatedArticle.created_at_matter ?? relatedArticle.updated_at_matter), formatMinutes(relatedArticle.estimated_reading_time_minutes ?? 0)]
                            .filter(Boolean)
                            .join(" • ")}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </PageShell>
  );
}

function MetadataRow({ label, value, href }: { label: string; value: string | null; href?: string | null }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      {href && value ? (
        <a href={href} target="_blank" rel="noreferrer" className="truncate font-medium text-primary underline-offset-4 hover:underline">
          {value}
        </a>
      ) : (
        <span className="font-medium text-foreground">{value ?? "—"}</span>
      )}
    </div>
  );
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-background/60 p-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold text-foreground">{value}</span>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
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

function EmptyState({ icon: Icon, message, compact = false }: { icon: LucideIcon; message: string; compact?: boolean }) {
  return (
    <div className={`flex ${compact ? "min-h-32" : "min-h-48"} flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-muted/20 p-8 text-center text-sm text-muted-foreground`}>
      <Icon className="mb-3 h-6 w-6 text-primary" aria-hidden />
      {message}
    </div>
  );
}

function resolveCompletionPercent(progress: number | null, status: string | null, wordCount: number, wordsRead: number): number | null {
  if (typeof progress === "number" && Number.isFinite(progress)) {
    return progress <= 1 ? progress * 100 : progress;
  }

  if (status?.toLowerCase() === "completed" || status?.toLowerCase() === "read") {
    return 100;
  }

  if (wordCount > 0 && wordsRead > 0) {
    return Math.min((wordsRead / wordCount) * 100, 100);
  }

  return null;
}

function resolveSessionProgressPercent(wordsEstimated: number | null, wordCount: number): number | null {
  if (!wordsEstimated || wordCount <= 0) {
    return null;
  }

  return Math.min((wordsEstimated / wordCount) * 100, 100);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatPerformance(value: number | null): string {
  if (value === null) {
    return "—";
  }

  if (Math.abs(value) < 1) {
    return "On average";
  }

  return `${Math.abs(Math.round(value))}% ${value > 0 ? "above" : "below"} average`;
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

function formatDuration(seconds: number): string {
  if (seconds <= 0) {
    return "—";
  }

  const minutes = Math.round(seconds / 60);
  return formatMinutes(minutes);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
