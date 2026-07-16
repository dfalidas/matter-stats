"use client";

import { useMemo, useState, useTransition } from "react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, BookOpen, Clock, Highlighter, Newspaper, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { METRICS_PERIOD_PRESETS, type MetricsPeriodPreset } from "@/lib/metrics-service";
import {
  compareSources,
  SOURCE_RANKING_SORT_KEYS,
  type SourceRanking,
  type SourceRankingSortKey,
} from "@/lib/sources-service";
import { cn } from "@/lib/utils";

type SourcesRankingProps = {
  period: MetricsPeriodPreset;
  ranking: SourceRanking;
};

const periodLabels: Record<MetricsPeriodPreset, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
  "all-time": "All time",
};

const sortLabels: Record<SourceRankingSortKey, string> = {
  "reading-time": "Reading time",
  articles: "Articles",
  words: "Words read",
  highlights: "Highlights",
};

const sortIcons: Record<SourceRankingSortKey, typeof Clock> = {
  "reading-time": Clock,
  articles: Newspaper,
  words: BookOpen,
  highlights: Highlighter,
};

export function SourcesRanking({ period, ranking }: SourcesRankingProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SourceRankingSortKey>("reading-time");

  const filteredSources = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return ranking.sources
      .filter((source) => source.source.toLocaleLowerCase().includes(normalizedQuery))
      .sort(compareSources(sortKey));
  }, [query, ranking.sources, sortKey]);

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
        <StatCard label="Words read" value={formatInteger(ranking.totals.wordsRead)} icon={BookOpen} />
        <StatCard label="Articles" value={formatInteger(ranking.totals.articlesRead)} icon={Newspaper} />
        <StatCard label="Highlights" value={formatInteger(ranking.totals.highlights)} icon={Highlighter} />
      </section>

      <Card className="border-white/10 bg-background/55 shadow-soft">
        <CardHeader className="gap-4 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-2xl font-semibold tracking-tight">Source ranking</CardTitle>
                <Badge variant="secondary" className="rounded-full">
                  {periodLabels[period]}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Ranked from real Matter reading sessions and annotations stored in Supabase.
              </p>
            </div>

            <div className="flex flex-wrap gap-2" aria-label="Filter sources by period">
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
              <span className="sr-only">Search source names</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search source names..."
                className="pl-9"
              />
            </label>

            <div className="flex flex-wrap gap-2" aria-label="Sort source ranking">
              {SOURCE_RANKING_SORT_KEYS.map((key) => {
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
          {ranking.sources.length === 0 ? (
            <EmptyRanking message="No source reading data was found for this period." />
          ) : filteredSources.length === 0 ? (
            <EmptyRanking message={`No sources match “${query.trim()}”.`} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[220px]">Source</TableHead>
                  <TableHead className="text-right">Reading time</TableHead>
                  <TableHead className="text-right">Words read</TableHead>
                  <TableHead className="text-right">Articles</TableHead>
                  <TableHead className="text-right">Highlights</TableHead>
                  <TableHead className="min-w-[180px] text-right">Share of reading</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSources.map((source, index) => (
                  <TableRow key={source.source}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {index + 1}
                        </span>
                        <span className="font-medium text-foreground">{source.source}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatDuration(source.readingTimeSeconds)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInteger(source.wordsRead)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInteger(source.articlesRead)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInteger(source.highlights)}</TableCell>
                    <TableCell className="text-right">
                      <div className="ml-auto flex max-w-[190px] items-center justify-end gap-3">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: source.shareOfReading > 0 ? `${Math.max(2, source.shareOfReading * 100)}%` : "0%" }}
                          />
                        </div>
                        <span className="w-12 text-right tabular-nums text-muted-foreground">
                          {formatPercent(source.shareOfReading)}
                        </span>
                      </div>
                    </TableCell>
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

function formatPercent(value: number): string {
  return new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 }).format(value);
}
