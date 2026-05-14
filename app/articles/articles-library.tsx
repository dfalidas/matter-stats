"use client";

import { useMemo, useState, useTransition } from "react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookOpen, CalendarDays, Clock, FileText, Highlighter, Search, Tags } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ArticleListResult } from "@/lib/articles-service";
import { METRICS_PERIOD_PRESETS, type MetricsPeriodPreset } from "@/lib/metrics-service";
import { cn } from "@/lib/utils";

type ArticlesLibraryProps = {
  result: ArticleListResult;
};

const periodLabels: Record<MetricsPeriodPreset, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
  "all-time": "All time",
};

export function ArticlesLibrary({ result }: ArticlesLibraryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(result.filters.query);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const activeSource = result.sources.find((source) => source.value === result.filters.source)?.label;
  const activeTag = result.tags.find((tag) => tag.value === result.filters.tag)?.label;

  const summary = useMemo(() => {
    return result.articles.reduce(
      (totals, article) => ({
        words: totals.words + (article.word_count ?? 0),
        minutes: totals.minutes + (article.estimated_reading_time_minutes ?? 0),
        highlights: totals.highlights + article.highlights,
      }),
      { words: 0, minutes: 0, highlights: 0 },
    );
  }, [result.articles]);

  function updateParam(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (value) {
      params.set(name, value);
    } else {
      params.delete(name);
    }

    if (name !== "page") {
      params.delete("page");
    }

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}` as Route);
    });
  }

  function applySearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateParam("q", query.trim());
  }

  function openArticle(id: string) {
    router.push(`/articles/${encodeURIComponent(id)}` as Route);
  }

  return (
    <div className={cn("space-y-5", isPending && "opacity-75 transition-opacity")}>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Matching articles" value={formatInteger(result.total)} icon={FileText} />
        <StatCard label="Page reading time" value={formatMinutes(summary.minutes)} icon={Clock} />
        <StatCard label="Page words" value={formatInteger(summary.words)} icon={BookOpen} />
        <StatCard label="Page highlights" value={formatInteger(summary.highlights)} icon={Highlighter} />
      </section>

      <Card className="border-white/10 bg-background/55 shadow-soft">
        <CardHeader className="gap-4 pb-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-2xl font-semibold tracking-tight">Articles</CardTitle>
                <Badge variant="secondary" className="rounded-full">
                  {periodLabels[result.filters.period]}
                </Badge>
                {activeSource ? <Badge className="rounded-full">{activeSource}</Badge> : null}
                {activeTag ? <Badge className="rounded-full">#{activeTag}</Badge> : null}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Search title, source, or author. Results are paged to keep large personal libraries responsive.
              </p>
            </div>

            <div className="flex flex-wrap gap-2" aria-label="Filter articles by period">
              {METRICS_PERIOD_PRESETS.map((period) => (
                <Button
                  key={period}
                  type="button"
                  variant={period === result.filters.period ? "default" : "outline"}
                  size="sm"
                  disabled={isPending}
                  onClick={() => updateParam("period", period)}
                >
                  {periodLabels[period]}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1fr)]">
            <form onSubmit={applySearch} className="flex gap-2">
              <label className="relative block min-w-0 flex-1">
                <span className="sr-only">Search articles by title, source, or author</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search title, source, author..."
                  className="pl-9"
                />
              </label>
              <Button type="submit" disabled={isPending}>Search</Button>
            </form>

            <div className="grid gap-2 md:grid-cols-2">
              <FilterSelect
                label="Source"
                value={result.filters.source}
                disabled={isPending}
                onChange={(value) => updateParam("source", value)}
                options={result.sources.map((source) => ({
                  value: source.value,
                  label: source.count ? `${source.label} (${source.count})` : source.label,
                }))}
              />
              <FilterSelect
                label="Tag"
                value={result.filters.tag}
                disabled={isPending}
                onChange={(value) => updateParam("tag", value)}
                options={result.tags.map((tag) => ({ value: tag.value, label: tag.label }))}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {result.articles.length === 0 ? (
            <EmptyArticles
              hasFilters={Boolean(result.filters.query || result.filters.source || result.filters.tag || result.filters.period !== "all-time")}
              onClear={() => {
                setQuery("");
                startTransition(() => router.push(pathname as Route));
              }}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-[280px]">Title</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead className="min-w-[120px]">Date</TableHead>
                    <TableHead className="text-right">Reading time</TableHead>
                    <TableHead className="text-right">Words</TableHead>
                    <TableHead className="text-right">Highlights</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.articles.map((article) => (
                    <TableRow
                      key={article.id}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${article.title ?? "Untitled article"}`}
                      onClick={() => openArticle(article.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openArticle(article.id);
                        }
                      }}
                      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                    >
                      <TableCell>
                        <div className="space-y-2">
                          <div className="font-medium leading-6 text-foreground">{article.title ?? "Untitled article"}</div>
                          {article.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {article.tags.slice(0, 3).map((tag) => (
                                <Badge key={tag.id} variant="outline" className="rounded-full text-[11px]">
                                  <Tags className="mr-1 h-3 w-3" aria-hidden />
                                  {tag.name}
                                </Badge>
                              ))}
                              {article.tags.length > 3 ? (
                                <Badge variant="outline" className="rounded-full text-[11px]">+{article.tags.length - 3}</Badge>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{article.source ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{article.author ?? "—"}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                          {formatDate(article.created_at_matter ?? article.updated_at_matter)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMinutes(article.estimated_reading_time_minutes ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInteger(article.word_count ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInteger(article.highlights)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="rounded-full capitalize">{article.status ?? "Unknown"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Showing {formatInteger((result.page - 1) * result.pageSize + 1)}–{formatInteger((result.page - 1) * result.pageSize + result.articles.length)} of {formatInteger(result.total)} articles
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={result.page <= 1 || isPending} onClick={() => updateParam("page", String(result.page - 1))}>
                    Previous
                  </Button>
                  <span className="px-2 tabular-nums">Page {result.page} of {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={result.page >= totalPages || isPending} onClick={() => updateParam("page", String(result.page + 1))}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterSelect({ label, value, options, disabled, onChange }: { label: string; value: string; options: { value: string; label: string }[]; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-xl border border-input bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">All {label.toLowerCase()}s</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof FileText }) {
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

function EmptyArticles({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-muted/20 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <FileText className="h-7 w-7" aria-hidden />
      </span>
      <h3 className="mt-5 text-xl font-semibold tracking-tight text-foreground">No articles found</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {hasFilters
          ? "Try clearing a search term or broadening the period, source, or tag filters."
          : "Sync your Matter account to fill this library with article metadata, tags, and highlights."}
      </p>
      {hasFilters ? (
        <Button type="button" variant="secondary" className="mt-5" onClick={onClear}>Clear filters</Button>
      ) : null}
    </div>
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
