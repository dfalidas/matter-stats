"use client";

import { motion } from "framer-motion";
import {
  Award,
  BarChart3,
  BookOpen,
  CalendarDays,
  Flame,
  Hash,
  LibraryBig,
  Medal,
  Newspaper,
  PenLine,
  Share2,
  Sparkles,
  Tags,
  Trophy,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ArticleRow,
  ChartCard,
  EmptyState,
  ErrorState,
  MetricCard,
  RankingList,
  type DashboardIcon,
} from "@/components/dashboard-components";
import { Button } from "@/components/ui/button";
import type { ReadingHeatmapDay, ReadingMetrics } from "@/lib/metrics-service";
import type { ReadingReport } from "@/lib/reports-service";

const WORDS_PER_BOOK = 80_000;

export type YearInReadingResult =
  | {
      ok: true;
      report: ReadingReport;
    }
  | {
      ok: false;
      message: string;
    };

type YearInReadingOverviewProps = {
  year: number;
  recapResult: YearInReadingResult;
};

type MonthPoint = {
  id: string;
  label: string;
  words: number;
  articles: number;
  minutes: number;
  sessions: number;
};

export function YearInReadingOverview({ year, recapResult }: YearInReadingOverviewProps) {
  if (!recapResult.ok) {
    return (
      <ErrorState
        title="Unable to load your annual recap"
        description="Matter Stats could not read this year's Supabase metrics."
        message={recapResult.message}
      />
    );
  }

  return <YearInReadingContent year={year} report={recapResult.report} />;
}

function YearInReadingContent({ year, report }: { year: number; report: ReadingReport }) {
  const { metrics } = report;
  const monthData = buildMonthData(metrics.heatmap, year);
  const activeMonths = monthData.filter((month) => month.words > 0 || month.minutes > 0 || month.articles > 0);
  const mostActiveMonth = getMostActiveMonth(monthData);
  const mostProductiveDay = getMostProductiveDay(metrics.heatmap);
  const longestRead = report.longformReads[0];
  const topPublication = metrics.topSources[0];
  const topAuthor = metrics.topAuthors[0];
  const booksEquivalent = metrics.totals.wordsRead / WORDS_PER_BOOK;
  const personality = getReadingPersonality(metrics, activeMonths.length);
  const isLowData = metrics.totals.articlesRead < 3 && metrics.totals.wordsRead < WORDS_PER_BOOK / 2;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="space-y-5"
    >
      <section className="overflow-hidden rounded-[2rem] border border-dashboard-border bg-[radial-gradient(circle_at_top_left,hsl(var(--accent-red)/0.26),transparent_28rem),radial-gradient(circle_at_85%_10%,hsl(var(--accent-violet)/0.18),transparent_24rem),linear-gradient(135deg,hsl(var(--dashboard-card)/0.98),hsl(var(--dashboard-card)/0.72))] p-6 shadow-soft md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.26em] text-primary">
              <Sparkles className="h-4 w-4" aria-hidden /> Annual recap
            </p>
            <h2 className="mt-3 text-4xl font-bold tracking-tight text-dashboard-text md:text-6xl">
              Your {year} in Reading
            </h2>
            <p className="mt-4 text-base leading-8 text-dashboard-muted md:text-lg">
              {getHeroSentence(metrics, booksEquivalent, isLowData)}
            </p>
          </div>
          <Button
            type="button"
            disabled
            className="h-11 rounded-2xl px-5 shadow-lg shadow-primary/10"
            aria-label="Share recap placeholder"
          >
            <Share2 className="h-4 w-4" aria-hidden /> Share Recap
          </Button>
        </div>
      </section>

      {isLowData ? (
        <div className="rounded-3xl border border-warning/20 bg-warning/10 p-4 text-sm text-dashboard-muted">
          This recap is ready, but {year} has limited synced reading data so far. As more Matter sessions sync, these cards will fill in automatically.
        </div>
      ) : null}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        <MetricCard
          label="Words Read"
          value={formatInteger(metrics.totals.wordsRead)}
          helper={`${formatDuration(metrics.totals.totalReadingTimeSeconds)} of focused reading`}
          icon={BookOpen}
          accent="red"
          tooltip="Estimated words read from synced Matter reading sessions in the current year."
        />
        <MetricCard
          label="Articles Read"
          value={formatInteger(metrics.totals.articlesRead)}
          helper={`${formatInteger(metrics.totals.sessionsCount)} reading sessions`}
          icon={Newspaper}
          accent="blue"
          tooltip="Unique Matter items with reading activity during the current year."
        />
        <MetricCard
          label="Equivalent Books"
          value={formatBooks(booksEquivalent)}
          helper={`Using ${formatInteger(WORDS_PER_BOOK)} words per book`}
          icon={LibraryBig}
          accent="violet"
          tooltip="Book-equivalent estimate based on an 80,000-word default assumption."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SpotlightCard
          title="Top Publication"
          value={topPublication?.name ?? "Not enough data yet"}
          helper={topPublication ? `${formatInteger(topPublication.wordsRead)} words • ${formatInteger(topPublication.articlesRead)} articles` : "Publications appear after reads sync with source metadata."}
          icon={Newspaper}
        />
        <SpotlightCard
          title="Top Author"
          value={topAuthor?.name ?? "Not enough data yet"}
          helper={topAuthor ? `${formatInteger(topAuthor.wordsRead)} words • ${formatInteger(topAuthor.articlesRead)} articles` : "Authors appear after synced items include bylines."}
          icon={PenLine}
        />
        <SpotlightCard
          title="Longest Read"
          value={longestRead?.title ?? "Not enough data yet"}
          helper={longestRead ? `${formatInteger(longestRead.wordsRead)} words • ${formatDuration(longestRead.readingTimeSeconds)}` : "Longform reads appear once sessions are synced."}
          icon={Trophy}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <ChartCard
          title="Reading Journey"
          description="Words read by month across the current year."
          badge={year}
          action={<BarChart3 className="h-5 w-5 text-dashboard-muted" aria-hidden />}
          contentClassName="h-80"
        >
          {activeMonths.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthData} margin={{ top: 8, right: 18, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--dashboard-border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="hsl(var(--dashboard-muted))" tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--dashboard-muted))" tickLine={false} axisLine={false} width={54} tickFormatter={formatCompact} />
                <RechartsTooltip
                  cursor={{ fill: "hsl(var(--accent-red) / 0.08)" }}
                  contentStyle={{ background: "hsl(var(--dashboard-card))", border: "1px solid hsl(var(--dashboard-border))", borderRadius: "16px", color: "hsl(var(--dashboard-text))" }}
                  formatter={(value, name) => [name === "words" ? `${formatInteger(Number(value))} words` : value, "Words read"]}
                  labelFormatter={(label) => `${label} ${year}`}
                />
                <Bar dataKey="words" fill="hsl(var(--accent-red))" radius={[10, 10, 4, 4]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No monthly journey yet" description="Your month-by-month recap will appear after reading sessions sync for this year." icon={BarChart3} className="h-full" />
          )}
        </ChartCard>

        <ChartCard title="Reading Personality" description="A playful summary based on your current-year habits." action={<Sparkles className="h-5 w-5 text-dashboard-muted" aria-hidden />}>
          <div className="rounded-3xl border border-primary/20 bg-primary/10 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <personality.icon className="h-6 w-6" aria-hidden />
            </div>
            <h3 className="mt-4 text-2xl font-bold text-dashboard-text">{personality.title}</h3>
            <p className="mt-2 text-sm leading-6 text-dashboard-muted">{personality.description}</p>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <ChartCard title="Top Topics" description="Topics inferred from your most-used synced Matter tags." action={<Hash className="h-5 w-5 text-dashboard-muted" aria-hidden />}>
          {metrics.topTags.length > 0 ? (
            <RankingList
              items={metrics.topTags.slice(0, 5).map((tag) => ({
                id: tag.name,
                label: tag.name,
                value: Math.max(1, Math.round(tag.wordsRead / 1000)),
                helper: `${formatInteger(tag.wordsRead)} words • ${formatInteger(tag.articlesRead)} articles`,
                accent: "blue",
              }))}
              maxValue={Math.max(...metrics.topTags.slice(0, 5).map((tag) => Math.max(1, Math.round(tag.wordsRead / 1000))), 1)}
            />
          ) : (
            <EmptyState title="No topics yet" description="Tags from synced Matter items power your topic recap." icon={Hash} />
          )}
        </ChartCard>

        <ChartCard title="Milestones" description="Your biggest current-year reading moments." action={<Medal className="h-5 w-5 text-dashboard-muted" aria-hidden />}>
          <div className="space-y-3">
            <MilestoneRow label="Most Active Month" value={mostActiveMonth ? mostActiveMonth.label : "Not yet"} helper={mostActiveMonth ? `${formatInteger(mostActiveMonth.words)} words` : "Read in more months to unlock this."} icon={CalendarDays} />
            <MilestoneRow label="Best Streak" value={`${formatInteger(metrics.bestStreakDays)} ${pluralize("day", metrics.bestStreakDays)}`} helper={metrics.bestStreakDays > 0 ? "Longest reading streak this year" : "Start a streak with your next read."} icon={Flame} />
            <MilestoneRow label="Most Productive Day" value={mostProductiveDay ? formatDateLabel(mostProductiveDay.date) : "Not yet"} helper={mostProductiveDay ? `${formatInteger(mostProductiveDay.wordsRead)} words` : "Daily highs appear after reading sessions sync."} icon={Award} />
          </div>
        </ChartCard>

        <ChartCard title="Top Tags" description="Your most frequent reading labels by reading time." action={<Tags className="h-5 w-5 text-dashboard-muted" aria-hidden />}>
          {metrics.topTags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {metrics.topTags.slice(0, 12).map((tag, index) => (
                <span
                  key={tag.name}
                  className="rounded-full border border-dashboard-border bg-background/40 px-3 py-2 text-sm font-medium text-dashboard-text"
                  style={{ opacity: Math.max(0.62, 1 - index * 0.035) }}
                >
                  #{tag.name}
                </span>
              ))}
            </div>
          ) : (
            <EmptyState title="No tags yet" description="Synced Matter tags will appear here as a recap cloud." icon={Tags} />
          )}
        </ChartCard>
      </div>

      <ChartCard title="Longest Reads" description="A few standout longform pieces from your current-year recap." action={<Trophy className="h-5 w-5 text-dashboard-muted" aria-hidden />}>
        {report.longformReads.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {report.longformReads.slice(0, 4).map((read) => (
              <ArticleRow
                key={read.itemId}
                title={read.title ?? "Untitled read"}
                source={read.source ?? read.author ?? "Matter"}
                meta={`${formatInteger(read.wordsRead)} words • ${formatDuration(read.readingTimeSeconds)}`}
                status={read.estimatedReadingTimeMinutes ? `${read.estimatedReadingTimeMinutes} min read` : "Longform"}
                href={read.url ?? undefined}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No longform reads yet" description="Your longest reads will appear once current-year Matter sessions are synced." icon={BookOpen} />
        )}
      </ChartCard>
    </motion.div>
  );
}

function SpotlightCard({ title, value, helper, icon: Icon }: { title: string; value: string; helper: string; icon: DashboardIcon }) {
  return (
    <div className="group rounded-3xl border border-dashboard-border bg-dashboard-card/80 p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-dashboard-card/95 hover:shadow-lg">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-dashboard-muted">{title}</p>
        <span className="rounded-2xl border border-primary/20 bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      </div>
      <p className="mt-4 line-clamp-2 text-2xl font-bold tracking-tight text-dashboard-text">{value}</p>
      <p className="mt-2 text-sm text-dashboard-muted">{helper}</p>
    </div>
  );
}

function MilestoneRow({ label, value, helper, icon: Icon }: { label: string; value: string; helper: string; icon: DashboardIcon }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashboard-border bg-background/35 p-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-dashboard-muted">{label}</p>
        <p className="truncate text-sm font-semibold text-dashboard-text">{value}</p>
        <p className="truncate text-xs text-dashboard-muted">{helper}</p>
      </div>
    </div>
  );
}

function buildMonthData(heatmap: ReadingHeatmapDay[], year: number): MonthPoint[] {
  const months = Array.from({ length: 12 }, (_, index) => ({
    id: `${year}-${String(index + 1).padStart(2, "0")}`,
    label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, index, 1))),
    words: 0,
    articles: 0,
    minutes: 0,
    sessions: 0,
  }));

  for (const day of heatmap) {
    const date = new Date(`${day.date}T00:00:00.000Z`);
    if (date.getUTCFullYear() !== year) {
      continue;
    }

    const month = months[date.getUTCMonth()];
    month.words += day.wordsRead;
    month.articles += day.articlesRead;
    month.minutes += Math.round(day.readingTimeSeconds / 60);
    month.sessions += day.sessionsCount;
  }

  return months;
}

function getMostActiveMonth(months: MonthPoint[]): MonthPoint | null {
  const [topMonth] = [...months]
    .filter((month) => month.words > 0 || month.minutes > 0)
    .sort((a, b) => b.words - a.words || b.minutes - a.minutes || b.articles - a.articles);
  return topMonth ?? null;
}

function getMostProductiveDay(heatmap: ReadingHeatmapDay[]): ReadingHeatmapDay | null {
  const [topDay] = [...heatmap]
    .filter((day) => day.wordsRead > 0 || day.readingTimeSeconds > 0)
    .sort((a, b) => b.wordsRead - a.wordsRead || b.readingTimeSeconds - a.readingTimeSeconds);
  return topDay ?? null;
}

function getReadingPersonality(metrics: ReadingMetrics, activeMonthCount: number) {
  if (metrics.totals.articlesRead === 0) {
    return {
      title: "Recap Rookie",
      description: "Your annual reading story is waiting for its first synced Matter session this year.",
      icon: Sparkles,
    };
  }

  if (metrics.bestStreakDays >= 14) {
    return {
      title: "Streak Keeper",
      description: "You built a dependable reading rhythm and returned to your queue across many consecutive days.",
      icon: Flame,
    };
  }

  if (metrics.totals.wordsRead >= WORDS_PER_BOOK * 3) {
    return {
      title: "Deep Diver",
      description: "Your year leaned longform, with enough words to rival a serious stack of books.",
      icon: LibraryBig,
    };
  }

  if (activeMonthCount >= 6) {
    return {
      title: "Steady Explorer",
      description: "You kept reading across the calendar, building a consistent journey month after month.",
      icon: CalendarDays,
    };
  }

  return {
    title: "Curious Collector",
    description: "You sampled ideas across your queue. Add more sessions to sharpen this personality over time.",
    icon: BookOpen,
  };
}

function getHeroSentence(metrics: ReadingMetrics, booksEquivalent: number, isLowData: boolean): string {
  if (metrics.totals.articlesRead === 0) {
    return "No current-year reading sessions have synced yet. Once Matter activity appears, this page becomes your annual recap.";
  }

  const base = `You read ${formatInteger(metrics.totals.wordsRead)} words across ${formatInteger(metrics.totals.articlesRead)} ${pluralize("article", metrics.totals.articlesRead)} — about ${formatBooks(booksEquivalent)} using an ${formatInteger(WORDS_PER_BOOK)}-word book benchmark.`;
  return isLowData ? `${base} It is still early, so every new synced read will reshape the recap.` : base;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en").format(Math.max(0, Math.round(value)));
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatBooks(value: number): string {
  if (value === 0) {
    return "0 books";
  }

  return `${new Intl.NumberFormat("en", { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${pluralize("book", value)}`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${formatInteger(minutes)} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${formatInteger(hours)}h ${remainingMinutes}m` : `${formatInteger(hours)}h`;
}

function formatDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));
}

function pluralize(noun: string, count: number): string {
  return Math.abs(count) === 1 ? noun : `${noun}s`;
}
