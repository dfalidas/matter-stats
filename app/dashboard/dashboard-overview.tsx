"use client";

import { format, parseISO, subDays } from "date-fns";
import { Activity, Clock, Flame, Highlighter, Newspaper } from "lucide-react";
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
  HeatmapGrid,
  LoadingSkeleton,
  MetricCard,
  PeriodSelector,
  RankingList,
} from "@/components/dashboard-components";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DailyStat } from "@/lib/supabase-types";
import type { DashboardSummary } from "@/lib/supabase-queries";

import { SyncMatterButton } from "./sync-matter-button";

type DashboardOverviewProps = {
  summary: DashboardSummary;
  readingTrend: DailyStat[];
};

const recentActivity = [
  { title: "Sync Matter data", source: "Matter", status: "Ready", meta: "Imports library, sessions, tags, and annotations" },
  { title: "Recalculate daily stats", source: "daily_stats", status: "Automatic", meta: "Refreshes affected reading days" },
  { title: "Render dashboard charts", source: "daily_stats", status: "Live", meta: "Keeps reusable cards data-ready" },
];

const periodOptions = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

export function DashboardOverview({ summary, readingTrend }: DashboardOverviewProps) {
  const chartData = buildChartData(readingTrend);
  const totalHighlights = readingTrend.reduce((total, stat) => total + stat.highlights_count, 0);
  const totalSessions = chartData.reduce((total, stat) => total + stat.sessions, 0);
  const totalWords = chartData.reduce((total, stat) => total + stat.words, 0);
  const peakArticles = Math.max(...chartData.map((stat) => stat.articles), 1);
  const metrics = [
    {
      label: "Articles read",
      value: formatInteger(summary.articlesRead),
      helper: "Summed from daily_stats",
      icon: Newspaper,
      accent: "red" as const,
    },
    {
      label: "Reading time",
      value: formatDuration(summary.readingTimeSeconds),
      helper: "Tracked across sessions",
      icon: Clock,
      accent: "violet" as const,
    },
    {
      label: "Top source",
      value: summary.topSource ?? "—",
      helper: "Latest active daily leader",
      icon: Activity,
      accent: "blue" as const,
    },
    {
      label: "Current streak",
      value: `${summary.currentStreakDays} ${summary.currentStreakDays === 1 ? "day" : "days"}`,
      helper: "Daily reading momentum",
      icon: Flame,
      accent: "amber" as const,
    },
  ];

  const rankingItems = [
    { id: "articles", label: "Articles", value: chartData.reduce((total, stat) => total + stat.articles, 0), helper: "Completed reads", accent: "red" as const },
    { id: "minutes", label: "Minutes", value: chartData.reduce((total, stat) => total + stat.minutes, 0), helper: "Focused reading", accent: "violet" as const },
    { id: "sessions", label: "Sessions", value: totalSessions, helper: "Recorded sessions", accent: "blue" as const },
    { id: "highlights", label: "Highlights", value: totalHighlights, helper: "Saved annotations", accent: "amber" as const },
  ];

  const heatmapItems = chartData.map((stat) => ({
    id: stat.date,
    label: stat.label,
    value: stat.articles,
    ariaLabel: `${stat.label}: ${stat.articles} articles read`,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-dashboard-border bg-dashboard-card/70 p-5 shadow-soft backdrop-blur md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-dashboard-text">Manual Matter import</h2>
          <p className="mt-1 text-sm text-dashboard-muted">
            Fetch Matter library, sessions, tags, and annotations, then rebuild daily_stats for affected days.
          </p>
        </div>
        <SyncMatterButton />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            helper={metric.helper}
            icon={metric.icon}
            accent={metric.accent}
          />
        ))}
      </div>

      <Tabs defaultValue="trend" className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <TabsList className="bg-muted/70">
            <TabsTrigger value="trend">Trend</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="loading">Loading state</TabsTrigger>
          </TabsList>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <PeriodSelector value="7d" options={periodOptions} />
            <Input className="border-dashboard-border bg-dashboard-card/70 md:max-w-xs" placeholder="Filter articles after import..." aria-label="Filter articles" />
          </div>
        </div>

        <TabsContent value="trend">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <ChartCard
              title="Reading trend"
              description="Latest seven-day window read directly from the daily_stats table."
              badge="daily_stats"
              contentClassName="h-72"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ left: 0, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--dashboard-border))" />
                  <XAxis dataKey="label" stroke="hsl(var(--dashboard-muted))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--dashboard-muted))" fontSize={12} tickLine={false} axisLine={false} />
                  <RechartsTooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--dashboard-border))",
                      borderRadius: "var(--radius)",
                      color: "hsl(var(--popover-foreground))",
                    }}
                  />
                  <Area type="monotone" dataKey="articles" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1) / 0.22)" />
                  <Area type="monotone" dataKey="minutes" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2) / 0.14)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Weekly intensity" description="A compact heatmap for article volume." badge={`${formatInteger(totalWords)} words`}>
              <HeatmapGrid items={heatmapItems} maxValue={peakArticles} accent="red" />
              <div className="mt-5">
                <RankingList items={rankingItems} />
              </div>
            </ChartCard>
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <ChartCard
            title="Recent activity"
            description="Reusable article rows and badges for operational events."
            badge={`${formatInteger(totalHighlights)} highlights`}
          >
            <div className="space-y-3">
              {recentActivity.map((activity) => (
                <ArticleRow
                  key={activity.title}
                  title={activity.title}
                  source={activity.source}
                  meta={activity.meta}
                  status={activity.status}
                  tags={["Matter", "Supabase"]}
                />
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm text-dashboard-muted">
              <Highlighter className="h-4 w-4 text-accent-red" aria-hidden />
              {formatInteger(totalHighlights)} highlights in the current seven-day chart window.
            </div>
          </ChartCard>
        </TabsContent>

        <TabsContent value="loading">
          <LoadingSkeleton variant="chart" rows={3} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function buildChartData(readingTrend: DailyStat[]) {
  const statsByDate = new Map(readingTrend.map((stat) => [stat.date, stat]));

  return Array.from({ length: 7 }, (_, index) => {
    const date = subDays(new Date(), 6 - index);
    const key = format(date, "yyyy-MM-dd");
    const stat = statsByDate.get(key);

    return {
      date: key,
      label: format(parseISO(key), "MMM d"),
      articles: stat?.items_read_count ?? 0,
      minutes: Math.round((stat?.reading_time_seconds ?? 0) / 60),
      words: stat?.words_read ?? 0,
      sessions: stat?.sessions_count ?? 0,
    };
  });
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatDuration(seconds: number) {
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
