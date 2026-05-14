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

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DailyStat } from "@/lib/supabase-types";
import type { DashboardSummary } from "@/lib/supabase-queries";

import { SyncMatterButton } from "./sync-matter-button";

type DashboardOverviewProps = {
  summary: DashboardSummary;
  readingTrend: DailyStat[];
};

const recentActivity = [
  { title: "Sync Matter data", source: "Matter", status: "Ready" },
  { title: "Recalculate daily stats", source: "daily_stats", status: "Automatic" },
  { title: "Render dashboard charts", source: "daily_stats", status: "Live" },
];

export function DashboardOverview({ summary, readingTrend }: DashboardOverviewProps) {
  const chartData = buildChartData(readingTrend);
  const totalHighlights = readingTrend.reduce((total, stat) => total + stat.highlights_count, 0);
  const metrics = [
    {
      label: "Articles read",
      value: formatInteger(summary.articlesRead),
      helper: "Summed from daily_stats",
      icon: Newspaper,
    },
    {
      label: "Reading time",
      value: formatDuration(summary.readingTimeSeconds),
      helper: "Tracked across sessions",
      icon: Clock,
    },
    {
      label: "Top source",
      value: summary.topSource ?? "—",
      helper: "Latest active daily leader",
      icon: Activity,
    },
    {
      label: "Current streak",
      value: `${summary.currentStreakDays} ${summary.currentStreakDays === 1 ? "day" : "days"}`,
      helper: "Daily reading momentum",
      icon: Flame,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-background/45 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Manual Matter import</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fetch Matter library, sessions, tags, and annotations, then rebuild daily_stats for affected days.
          </p>
        </div>
        <SyncMatterButton />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;

          return (
            <Card key={metric.label} className="border-white/10 bg-background/45">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardDescription>{metric.label}</CardDescription>
                <Icon className="h-4 w-4 text-primary" aria-hidden />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-foreground">{metric.value}</p>
                <p className="mt-2 text-sm text-muted-foreground">{metric.helper}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="trend" className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <TabsList>
            <TabsTrigger value="trend">Trend</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="loading">Loading state</TabsTrigger>
          </TabsList>
          <Input className="md:max-w-xs" placeholder="Filter articles after import..." aria-label="Filter articles" />
        </div>

        <TabsContent value="trend">
          <Card className="border-white/10 bg-background/45">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Reading trend</CardTitle>
                  <CardDescription>Latest seven-day window read directly from the daily_stats table.</CardDescription>
                </div>
                <Badge variant="outline">daily_stats</Badge>
              </div>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ left: 0, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <RechartsTooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      color: "hsl(var(--popover-foreground))",
                    }}
                  />
                  <Area type="monotone" dataKey="articles" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.22)" />
                  <Area type="monotone" dataKey="minutes" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2) / 0.14)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card className="border-white/10 bg-background/45">
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Sync and rollup status for the daily dashboard data path.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentActivity.map((activity) => (
                    <TableRow key={activity.title}>
                      <TableCell className="font-medium">{activity.title}</TableCell>
                      <TableCell>{activity.source}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{activity.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Highlighter className="h-4 w-4 text-primary" aria-hidden />
                {formatInteger(totalHighlights)} highlights in the current seven-day chart window.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="loading">
          <Card className="border-white/10 bg-background/45">
            <CardHeader>
              <CardTitle>Reusable skeletons</CardTitle>
              <CardDescription>Dark-mode loading primitives for future Supabase queries.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-5 w-4/5" />
            </CardContent>
          </Card>
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
