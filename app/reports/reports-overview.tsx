"use client";

import { useTransition } from "react";
import { motion } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, BookOpen, CalendarDays, Clock, FileText, Newspaper, Sparkles, Timer, Users } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ArticleRow, ChartCard, EmptyState, ErrorState, MetricCard, PeriodSelector, RankingList } from "@/components/dashboard-components";
import type { ReadingHeatmapDay } from "@/lib/metrics-service";
import type { ReadingReport, ReportPeriod } from "@/lib/reports-service";

import { SyncMatterButton } from "../dashboard/sync-matter-button";

type ReportsResult =
  | {
      ok: true;
      report: ReadingReport;
    }
  | {
      ok: false;
      message: string;
    };

type ReportsOverviewProps = {
  period: ReportPeriod;
  reportsResult: ReportsResult;
};

type DistributionPoint = {
  date: string;
  label: string;
  minutes: number;
  words: number;
  sessions: number;
};

const periodOptions = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const periodNouns: Record<ReportPeriod, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

export function ReportsOverview({ period, reportsResult }: ReportsOverviewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handlePeriodChange(nextPeriod: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", nextPeriod);
    startTransition(() => {
      const href = `${pathname}?${params.toString()}` as `/reports?${string}`;
      router.replace(href);
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-3xl border border-dashboard-border bg-dashboard-card/70 p-3.5 shadow-soft backdrop-blur sm:p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <PeriodSelector value={period} options={periodOptions} onValueChange={handlePeriodChange} label="Report period" />
          {isPending ? <span className="text-sm text-dashboard-muted">Loading report…</span> : null}
        </div>
        <SyncMatterButton />
      </div>

      {reportsResult.ok ? <ReportContent report={reportsResult.report} /> : <ErrorState title="Unable to load reports" description="Supabase did not return report metrics." message={reportsResult.message} />}
    </div>
  );
}

function ReportContent({ report }: { report: ReadingReport }) {
  const { metrics } = report;
  const isEmpty = isReportEmpty(report);
  const distributionData = buildDistributionData(metrics.heatmap, report.period);
  const rangeLabel = formatReportRange(report);
  const title = report.period === "weekly" ? `Week of ${rangeLabel}` : `${capitalize(report.period)} report`;
  const insight = buildInsightSentence(metrics.heatmap, report.period);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: "easeOut" }} className="space-y-5">
      <section className="overflow-hidden rounded-[2rem] border border-dashboard-border bg-[radial-gradient(circle_at_top_left,hsl(var(--accent-red)/0.22),transparent_28rem),linear-gradient(135deg,hsl(var(--dashboard-card)/0.96),hsl(var(--dashboard-card)/0.72))] p-6 shadow-soft md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.26em] text-primary">{capitalize(report.period)} report</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-dashboard-text md:text-5xl">{title}</h2>
            <p className="mt-3 max-w-3xl text-base leading-7 text-dashboard-muted md:text-lg">{insight}</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-background/30 p-4 text-sm text-dashboard-muted">
            <p className="font-medium text-dashboard-text">{rangeLabel}</p>
            <p className="mt-1">Updates whenever Matter sync refreshes Supabase.</p>
          </div>
        </div>
      </section>

      {isEmpty ? <EmptyState title={`No reading in this ${periodNouns[report.period]} yet`} description="Sync Matter or choose a different period to populate report cards, charts, rankings, and timelines." icon={Sparkles} action={<SyncMatterButton />} /> : null}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        <MetricCard label="Total Reading Time" value={formatDuration(metrics.totals.totalReadingTimeSeconds)} helper="Across synced reading sessions" icon={Clock} accent="violet" />
        <MetricCard label="Words Read" value={formatInteger(metrics.totals.wordsRead)} helper="Estimated from Matter sessions" icon={BookOpen} accent="blue" />
        <MetricCard label="Sessions" value={formatInteger(metrics.totals.sessionsCount)} helper={`Avg ${formatDuration(metrics.totals.averageSessionLengthSeconds)}`} icon={Timer} accent="amber" />
        <MetricCard label="Articles" value={formatInteger(metrics.totals.articlesRead)} helper="Unique Matter items read" icon={Newspaper} accent="red" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
        <ChartCard title="Daily Distribution" description="Minutes read per day in this report window." badge={capitalize(report.period)} contentClassName="h-80">
          {distributionData.some((day) => day.minutes > 0 || day.words > 0) ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distributionData} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--dashboard-border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="hsl(var(--dashboard-muted))" tickLine={false} axisLine={false} minTickGap={14} />
                <YAxis stroke="hsl(var(--dashboard-muted))" tickLine={false} axisLine={false} width={36} />
                <RechartsTooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.35)" }}
                  contentStyle={{ background: "hsl(var(--dashboard-card))", border: "1px solid hsl(var(--dashboard-border))", borderRadius: "16px", color: "hsl(var(--dashboard-text))" }}
                  formatter={(value, name) => [name === "minutes" ? `${value} min` : value, name === "minutes" ? "Reading time" : name]}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <Bar dataKey="minutes" fill="hsl(var(--accent-red))" radius={[10, 10, 4, 4]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No daily distribution" description="Reading activity will appear here after sessions are synced." className="h-full" icon={BarChart3} />
          )}
        </ChartCard>

        <ChartCard title="Reading Sessions Timeline" description="Chronological sessions imported from Supabase." action={<CalendarDays className="h-5 w-5 text-dashboard-muted" aria-hidden />}>
          {report.timeline.length > 0 ? (
            <div className="max-h-[22rem] space-y-3 overflow-y-auto pr-1">
              {report.timeline.map((session) => (
                <TimelineItem key={session.id} session={session} />
              ))}
            </div>
          ) : (
            <EmptyState title="No sessions yet" description="Synced sessions for this period will be listed as a timeline." icon={Clock} />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Top Authors" description="Authors ranked by reading time.">
          {metrics.topAuthors.length > 0 ? (
            <RankingList items={metrics.topAuthors.map((author) => ({ id: author.name, label: author.name, value: Math.round(author.readingTimeSeconds / 60), helper: `${formatInteger(author.articlesRead)} articles • ${formatInteger(author.wordsRead)} words`, accent: "violet" }))} maxValue={Math.max(...metrics.topAuthors.map((author) => Math.round(author.readingTimeSeconds / 60)), 1)} />
          ) : (
            <EmptyState title="No authors yet" description="Author rankings appear when synced sessions include author metadata." icon={Users} />
          )}
        </ChartCard>

        <ChartCard title="Top Sources" description="Sources ranked by reading time.">
          {metrics.topSources.length > 0 ? (
            <RankingList items={metrics.topSources.map((source) => ({ id: source.name, label: source.name, value: Math.round(source.readingTimeSeconds / 60), helper: `${formatInteger(source.articlesRead)} articles • ${formatInteger(source.wordsRead)} words`, accent: "blue" }))} maxValue={Math.max(...metrics.topSources.map((source) => Math.round(source.readingTimeSeconds / 60)), 1)} />
          ) : (
            <EmptyState title="No sources yet" description="Source rankings appear when synced sessions include source metadata." icon={FileText} />
          )}
        </ChartCard>
      </div>

      <ChartCard title="Best Longform Reads" description="Longest reads in the selected report period, ranked by estimated words read.">
        {report.longformReads.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {report.longformReads.map((read) => (
              <ArticleRow key={read.itemId} title={read.title ?? "Untitled read"} source={read.source ?? read.author ?? "Matter"} meta={`${formatInteger(read.wordsRead)} words • ${formatDuration(read.readingTimeSeconds)} • ${formatInteger(read.sessionsCount)} sessions`} status={read.estimatedReadingTimeMinutes ? `${read.estimatedReadingTimeMinutes} min read` : "Longform"} href={read.url ?? undefined} />
            ))}
          </div>
        ) : (
          <EmptyState title="No longform reads" description="Longer completed sessions will be highlighted here after sync." icon={BookOpen} />
        )}
      </ChartCard>
    </motion.div>
  );
}

function TimelineItem({ session }: { session: ReadingReport["timeline"][number] }) {
  return (
    <div className="relative rounded-2xl border border-dashboard-border bg-background/35 p-3.5 pl-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-muted/25 hover:shadow-sm">
      <span className="absolute left-0 top-4 h-10 w-1 rounded-full bg-primary" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-dashboard-text">{session.title ?? "Untitled session"}</p>
          <p className="mt-1 text-xs text-dashboard-muted">{formatSessionTime(session.startedAt)}{session.source ? ` • ${session.source}` : ""}{session.author ? ` • ${session.author}` : ""}</p>
        </div>
        <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{formatDuration(session.durationSeconds)}</span>
      </div>
      <p className="mt-2 text-xs text-dashboard-muted">{formatInteger(session.wordsRead)} words read</p>
    </div>
  );
}

function buildDistributionData(days: ReadingHeatmapDay[], period: ReportPeriod): DistributionPoint[] {
  const shouldCompress = period === "yearly";

  return days
    .filter((day) => !shouldCompress || day.readingTimeSeconds > 0 || day.wordsRead > 0 || day.sessionsCount > 0)
    .map((day) => ({
      date: day.date,
      label: formatDateLabel(day.date, period === "weekly" ? "weekday" : "short"),
      minutes: Math.round(day.readingTimeSeconds / 60),
      words: day.wordsRead,
      sessions: day.sessionsCount,
    }));
}

function buildInsightSentence(days: ReadingHeatmapDay[], period: ReportPeriod) {
  const activeDays = days.filter((day) => day.readingTimeSeconds > 0 || day.wordsRead > 0 || day.sessionsCount > 0).sort((a, b) => b.readingTimeSeconds - a.readingTimeSeconds || b.wordsRead - a.wordsRead);

  if (activeDays.length === 0) {
    return `No reading activity is synced for this ${periodNouns[period]} yet.`;
  }

  const topDay = activeDays[0];
  const runnerUp = activeDays[1];
  const topLabel = formatDateLabel(topDay.date, "weekday");
  const topDuration = formatDuration(topDay.readingTimeSeconds);

  if (runnerUp && runnerUp.readingTimeSeconds > 0) {
    return `${topLabel} led your reading with ${topDuration}, followed by ${formatDateLabel(runnerUp.date, "weekday")} at ${formatDuration(runnerUp.readingTimeSeconds)}.`;
  }

  return `${topLabel} was your most active reading day with ${topDuration} and ${formatInteger(topDay.wordsRead)} words.`;
}

function isReportEmpty(report: ReadingReport) {
  return report.metrics.totals.totalReadingTimeSeconds === 0 && report.metrics.totals.wordsRead === 0 && report.metrics.totals.sessionsCount === 0 && report.timeline.length === 0;
}

function formatReportRange(report: ReadingReport) {
  const { range } = report.metrics;
  const start = range.startDate ? formatDateLabel(range.startDate, "medium") : "Beginning";
  const end = formatDateLabel(getInclusiveEndDate(range.endDate), "medium");
  return `${start} – ${end}`;
}

function getInclusiveEndDate(endDate: string) {
  const date = new Date(`${endDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function formatSessionTime(value: string | null) {
  if (!value) {
    return "Time unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateLabel(value: string, style: "short" | "medium" | "weekday" = "short") {
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);

  if (style === "weekday") {
    return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: style === "medium" ? "long" : "short",
    day: "numeric",
  }).format(date);
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

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
