"use client";

import { useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  BookOpen,
  Clock,
  Flame,
  Newspaper,
  Tags,
} from "lucide-react";
import {
  Area,
  AreaChart,
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
  HeatmapGrid,
  LoadingSkeleton,
  MetricCard,
  PeriodSelector,
  RankingList,
} from "@/components/dashboard-components";
import type {
  MetricsPeriodPreset,
  ReadingHeatmapDay,
  ReadingMetrics,
} from "@/lib/metrics-service";
import { SESSION_METADATA_EMPTY_STATE } from "@/lib/metadata-coverage";

import { SyncMatterButton } from "./sync-matter-button";

type DashboardMetricsResult =
  | {
      ok: true;
      metrics: ReadingMetrics;
      todayMetrics: ReadingMetrics;
      allTimeMetrics: ReadingMetrics;
    }
  | {
      ok: false;
      message: string;
    };

type DashboardOverviewProps = {
  period: MetricsPeriodPreset;
  metricsResult: DashboardMetricsResult;
};

type TrendPoint = {
  date: string;
  label: string;
  minutes: number;
  words: number;
  articles: number;
};

const periodOptions: { value: MetricsPeriodPreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all-time", label: "All Time" },
];

export function DashboardOverview({
  period,
  metricsResult,
}: DashboardOverviewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handlePeriodChange(nextPeriod: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", nextPeriod);

    startTransition(() => {
      const href = `${pathname}?${params.toString()}` as `/dashboard?${string}`;
      router.push(href);
    });
  }

  if (!metricsResult.ok) {
    return (
      <div className="space-y-6">
        <Toolbar
          period={period}
          onPeriodChange={handlePeriodChange}
          isPending={isPending}
        />
        <ErrorState
          title="Dashboard metrics could not load"
          description="Matter Stats could not read the Supabase metrics service response."
          message={metricsResult.message}
        />
      </div>
    );
  }

  const { metrics, todayMetrics, allTimeMetrics } = metricsResult;
  const isEmpty = isDashboardEmpty(allTimeMetrics);
  const trendData = buildTrendData(metrics.heatmap);
  const heatmapItems = metrics.heatmap.map((day) => ({
    id: day.date,
    label: formatDateLabel(day.date),
    value: day.readingTimeSeconds,
    ariaLabel: `${formatDateLabel(day.date)}: ${formatDuration(day.readingTimeSeconds)} read`,
  }));
  const totalActiveDays = Math.max(
    1,
    allTimeMetrics.heatmap.filter(
      (day) => day.readingTimeSeconds > 0 || day.wordsRead > 0,
    ).length,
  );
  const dailyAverageSeconds = Math.round(
    allTimeMetrics.totals.totalReadingTimeSeconds / totalActiveDays,
  );
  const heroComparison = formatAverageComparison(
    todayMetrics.totals.totalReadingTimeSeconds,
    dailyAverageSeconds,
  );

  if (isEmpty) {
    return (
      <div className="space-y-6">
        <Toolbar
          period={period}
          onPeriodChange={handlePeriodChange}
          isPending={isPending}
        />
        <EmptyState
          title="No Matter reading data yet"
          description="Run a recent activity sync to import Matter sessions first. The dashboard will populate once recent reading sessions are available, even before your full library is backfilled."
          icon={BookOpen}
          action={<SyncMatterButton />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 lg:space-y-6">
      <Toolbar
        period={period}
        onPeriodChange={handlePeriodChange}
        isPending={isPending}
      />

      <AnimatePresence mode="popLayout">
        {isPending ? <DashboardPendingSkeleton key="period-loading" /> : null}
      </AnimatePresence>

      <motion.div
        key={period}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: isPending ? 0.55 : 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.26, ease: "easeOut" }}
        className="space-y-5 lg:space-y-6"
      >
        <section className="rounded-3xl border border-dashboard-border bg-gradient-to-br from-dashboard-card/95 via-dashboard-card/80 to-background/70 p-5 shadow-soft transition-all duration-200 hover:border-primary/25 hover:shadow-lg md:p-7">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">
            {formatPeriodRange(metrics)}
          </p>
          <h2 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-dashboard-text md:text-5xl">
            {getGreeting()}. You read{" "}
            {formatDuration(todayMetrics.totals.totalReadingTimeSeconds)} today.
          </h2>
          <p className="mt-3 text-base text-dashboard-muted md:text-lg">
            {heroComparison}
          </p>
        </section>

        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
          <MetricCard
            label="Reading Time"
            value={formatDuration(metrics.totals.totalReadingTimeSeconds)}
            helper={`${formatSignedPercent(metrics.comparison.delta.totalReadingTimePercentChange)} vs previous period`}
            icon={Clock}
            accent="violet"
            tooltip="Total Matter reading-session time in the selected period."
          />
          <MetricCard
            label="Words Read"
            value={formatInteger(metrics.totals.wordsRead)}
            helper={`${formatSignedPercent(metrics.comparison.delta.wordsReadPercentChange)} vs previous period`}
            icon={BookOpen}
            accent="blue"
            tooltip="Words read from synced Matter items during this period."
          />
          <MetricCard
            label="Reading Sessions"
            value={formatInteger(metrics.totals.sessionsCount)}
            helper={`${formatSignedPercent(metrics.comparison.delta.sessionsCountPercentChange)} vs previous period`}
            icon={Newspaper}
            accent="red"
            tooltip="Matter reading sessions imported during the selected period."
          />
          <MetricCard
            label="Current Streak"
            value={`${metrics.currentStreakDays} ${metrics.currentStreakDays === 1 ? "day" : "days"}`}
            helper={`Best streak: ${metrics.bestStreakDays} ${metrics.bestStreakDays === 1 ? "day" : "days"}`}
            icon={Flame}
            accent="amber"
            tooltip="Consecutive days with imported reading activity, plus your best all-time streak."
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.85fr)] xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
          <ChartCard
            title="Reading Time Trend"
            description="Minutes read from the metrics service for the selected period."
            badge={
              periodOptions.find((option) => option.value === period)?.label
            }
            contentClassName="h-72 sm:h-80"
          >
            {trendData.length === 0 ? (
              <EmptyState
                title="No trend data"
                description="No reading sessions were found for this period."
                className="h-full"
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={trendData}
                  margin={{ top: 12, right: 18, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="readingTimeGradient"
                      x1="0"
                      x2="0"
                      y1="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="hsl(var(--accent-red))"
                        stopOpacity={0.45}
                      />
                      <stop
                        offset="95%"
                        stopColor="hsl(var(--accent-red))"
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="hsl(var(--dashboard-border))"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    stroke="hsl(var(--dashboard-muted))"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={18}
                  />
                  <YAxis
                    stroke="hsl(var(--dashboard-muted))"
                    tickLine={false}
                    axisLine={false}
                    width={36}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      background: "hsl(var(--dashboard-card))",
                      border: "1px solid hsl(var(--dashboard-border))",
                      borderRadius: "16px",
                      color: "hsl(var(--dashboard-text))",
                    }}
                    formatter={(value, name) => [
                      name === "minutes" ? `${value} min` : value,
                      name === "minutes" ? "Reading time" : name,
                    ]}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="minutes"
                    stroke="hsl(var(--accent-red))"
                    fill="url(#readingTimeGradient)"
                    strokeWidth={3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Top Sources"
            description="Sources ranked by reading time."
          >
            {metrics.topSources.length > 0 ? (
              <RankingList
                items={metrics.topSources.map((source) => ({
                  id: source.name,
                  label: source.name,
                  value: Math.round(source.readingTimeSeconds / 60),
                  helper: `${formatInteger(source.articlesRead)} articles • ${formatInteger(source.wordsRead)} words`,
                  accent: "blue",
                }))}
                maxValue={Math.max(
                  ...metrics.topSources.map((source) =>
                    Math.round(source.readingTimeSeconds / 60),
                  ),
                  1,
                )}
              />
            ) : (
              <EmptyState
                title="No sources yet"
                description={SESSION_METADATA_EMPTY_STATE}
              />
            )}
          </ChartCard>
        </div>

        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <ChartCard
            title="Recent Reads"
            description="Most recent articles read in the selected period."
            className="xl:col-span-1"
          >
            {metrics.recentReads.length > 0 ? (
              <div className="space-y-2.5">
                {metrics.recentReads.map((read) => (
                  <ArticleRow
                    key={read.itemId}
                    title={read.title ?? "Reading session"}
                    source={read.source ?? read.author ?? "Matter"}
                    meta={`${read.readAt ? formatDateLabel(read.readAt) : "Unknown time"} • ${formatDuration(read.readingTimeSeconds)}`}
                    href={read.url ?? undefined}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No recent reads"
                description="Try another period or sync Matter to import recent sessions."
              />
            )}
          </ChartCard>

          <ChartCard
            title="Reading Heatmap"
            description="Daily reading intensity for the selected period."
            className="xl:col-span-1"
          >
            {heatmapItems.length > 0 ? (
              <HeatmapGrid
                items={heatmapItems}
                maxValue={Math.max(
                  ...heatmapItems.map((item) => item.value),
                  1,
                )}
                accent="red"
              />
            ) : (
              <EmptyState
                title="No heatmap activity"
                description="Reading days will light up after sessions are imported."
              />
            )}
          </ChartCard>

          <ChartCard
            title="Top Topics"
            description="Matter tags ranked by reading time."
            action={
              <Tags className="h-5 w-5 text-dashboard-muted" aria-hidden />
            }
          >
            {metrics.topTags.length > 0 ? (
              <RankingList
                items={metrics.topTags.map((topic) => ({
                  id: topic.name,
                  label: topic.name,
                  value: Math.round(topic.readingTimeSeconds / 60),
                  helper: `${formatInteger(topic.articlesRead)} articles • ${formatInteger(topic.wordsRead)} words`,
                  accent: "violet",
                }))}
                maxValue={Math.max(
                  ...metrics.topTags.map((topic) =>
                    Math.round(topic.readingTimeSeconds / 60),
                  ),
                  1,
                )}
              />
            ) : (
              <EmptyState
                title="No topics yet"
                description={SESSION_METADATA_EMPTY_STATE}
              />
            )}
          </ChartCard>
        </div>
      </motion.div>
    </div>
  );
}

function DashboardPendingSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]"
      aria-live="polite"
    >
      <LoadingSkeleton rows={1} />
      <LoadingSkeleton rows={1} />
      <LoadingSkeleton rows={1} />
      <LoadingSkeleton rows={1} />
    </motion.div>
  );
}

type ToolbarProps = {
  period: MetricsPeriodPreset;
  onPeriodChange: (period: string) => void;
  isPending: boolean;
};

function Toolbar({ period, onPeriodChange, isPending }: ToolbarProps) {
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-dashboard-border bg-dashboard-card/70 p-3.5 shadow-soft backdrop-blur sm:p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <PeriodSelector
          value={period}
          options={periodOptions}
          onValueChange={onPeriodChange}
          label="Dashboard period"
        />
        {isPending ? (
          <span className="text-sm text-dashboard-muted">
            Loading selected period…
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-start">
        <Activity className="h-5 w-5 text-dashboard-muted" aria-hidden />
        <SyncMatterButton />
      </div>
    </div>
  );
}

function buildTrendData(days: ReadingHeatmapDay[]): TrendPoint[] {
  return days
    .filter(
      (day) =>
        day.readingTimeSeconds > 0 ||
        day.wordsRead > 0 ||
        day.articlesRead > 0 ||
        days.length <= 370,
    )
    .map((day) => ({
      date: day.date,
      label: formatDateLabel(day.date),
      minutes: Math.round(day.readingTimeSeconds / 60),
      words: day.wordsRead,
      articles: day.articlesRead,
    }));
}

function isDashboardEmpty(metrics: ReadingMetrics): boolean {
  return (
    metrics.totals.totalReadingTimeSeconds === 0 &&
    metrics.totals.wordsRead === 0 &&
    metrics.totals.articlesRead === 0 &&
    metrics.recentReads.length === 0 &&
    metrics.topSources.length === 0 &&
    metrics.topTags.length === 0
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 18) {
    return "Good afternoon";
  }
  return "Good evening";
}

function formatPeriodRange(metrics: ReadingMetrics) {
  if (metrics.range.preset === "all-time") {
    return "All-time reading";
  }

  const start = metrics.range.startDate
    ? formatDateLabel(metrics.range.startDate)
    : "Beginning";
  const endDate = metrics.range.endDate
    ? formatDateLabel(metrics.range.endDate)
    : "Today";
  return `${start} – ${endDate}`;
}

function formatAverageComparison(todaySeconds: number, averageSeconds: number) {
  if (averageSeconds <= 0) {
    return todaySeconds > 0
      ? "You are setting your first daily average."
      : "Sync Matter to establish your daily average.";
  }

  const ratio = (todaySeconds - averageSeconds) / averageSeconds;
  const percent = Math.round(Math.abs(ratio) * 100);

  if (percent === 0) {
    return "Right on your daily average.";
  }

  return `${percent}% ${ratio >= 0 ? "above" : "below"} your daily average.`;
}

function formatSignedPercent(value: number | null) {
  if (value === null) {
    return "New activity";
  }

  const percent = Math.round(value * 100);
  if (percent === 0) {
    return "No change";
  }

  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateLabel(value: string) {
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}
