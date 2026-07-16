"use client";

import { useMemo, useState, useTransition } from "react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, BookOpen, Clock, Newspaper, Search, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AUTHOR_RANKING_SORT_KEYS,
  compareAuthors,
  type AuthorRanking,
  type AuthorRankingSortKey,
} from "@/lib/authors-service";
import { METRICS_PERIOD_PRESETS, type MetricsPeriodPreset } from "@/lib/metrics-service";
import { cn } from "@/lib/utils";

type AuthorsRankingProps = {
  period: MetricsPeriodPreset;
  ranking: AuthorRanking;
};

const periodLabels: Record<MetricsPeriodPreset, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
  "all-time": "All time",
};

const sortLabels: Record<AuthorRankingSortKey, string> = {
  "reading-time": "Reading time",
  articles: "Articles",
  words: "Words read",
  "top-source": "Top source",
};

const sortIcons: Record<AuthorRankingSortKey, typeof Clock> = {
  "reading-time": Clock,
  articles: Newspaper,
  words: BookOpen,
  "top-source": BookOpen,
};

export function AuthorsRanking({ period, ranking }: AuthorsRankingProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<AuthorRankingSortKey>("reading-time");

  const filteredAuthors = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return ranking.authors
      .filter((author) => {
        if (!normalizedQuery) {
          return true;
        }

        return (
          author.author.toLocaleLowerCase().includes(normalizedQuery) ||
          author.topSource.toLocaleLowerCase().includes(normalizedQuery)
        );
      })
      .sort(compareAuthors(sortKey));
  }, [query, ranking.authors, sortKey]);

  function updatePeriod(nextPeriod: MetricsPeriodPreset) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", nextPeriod);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}` as Route);
    });
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Reading time" value={formatDuration(ranking.totals.readingTimeSeconds)} icon={Clock} />
        <StatCard label="Authors" value={formatInteger(ranking.totals.authors)} icon={Users} />
        <StatCard label="Articles" value={formatInteger(ranking.totals.articlesRead)} icon={Newspaper} />
        <StatCard label="Words read" value={formatInteger(ranking.totals.wordsRead)} icon={BookOpen} />
      </section>

      <Card className="border-white/10 bg-background/55 shadow-soft">
        <CardHeader className="gap-4 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-2xl font-semibold tracking-tight">Author ranking</CardTitle>
                <Badge variant="secondary" className="rounded-full">
                  {periodLabels[period]}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Rank the writers behind your reading sessions, including articles with missing author metadata.
              </p>
            </div>

            <div className="flex flex-wrap gap-2" aria-label="Filter authors by period">
              {METRICS_PERIOD_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant={preset === period ? "default" : "outline"}
                  size="sm"
                  disabled={isPending}
                  onClick={() => updatePeriod(preset)}
                >
                  {periodLabels[preset]}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1fr)]">
            <label className="relative block">
              <span className="sr-only">Search author names or top sources</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search authors or sources..."
                className="pl-9"
              />
            </label>

            <div className="flex flex-wrap gap-2" aria-label="Sort author ranking">
              {AUTHOR_RANKING_SORT_KEYS.map((key) => {
                const Icon = sortIcons[key];
                return (
                  <Button
                    key={key}
                    type="button"
                    variant={key === sortKey ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setSortKey(key)}
                    className="rounded-full"
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {sortLabels[key]}
                    {key === sortKey ? <ArrowDown className="h-3.5 w-3.5" aria-hidden /> : null}
                  </Button>
                );
              })}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {ranking.authors.length === 0 ? (
            <EmptyRanking message="No author reading data was found for this period." />
          ) : filteredAuthors.length === 0 ? (
            <EmptyRanking message={`No authors or sources match “${query.trim()}”.`} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[220px]">Author</TableHead>
                  <TableHead className="text-right">Reading time</TableHead>
                  <TableHead className="text-right">Articles</TableHead>
                  <TableHead className="text-right">Words read</TableHead>
                  <TableHead className="min-w-[180px] text-right">Top source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAuthors.map((author, index) => (
                  <TableRow key={author.author}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {index + 1}
                        </span>
                        <span className="font-medium text-foreground">{author.author}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatDuration(author.readingTimeSeconds)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInteger(author.articlesRead)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInteger(author.wordsRead)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{author.topSource}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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

function EmptyRanking({ message }: { message: string }) {
  return (
    <div className={cn("flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-muted/20 p-8 text-center")}>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}
