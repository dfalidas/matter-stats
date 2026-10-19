"use client";
import Link from "next/link";
import type { Route } from "next";
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReportsClientPayload, ReportPeriod } from "@/lib/reports-service";
import { formatReportCsv } from "@/lib/report-csv";
import { addCalendarDays } from "@/lib/calendar";

type Result =
  | { ok: true; report: ReportsClientPayload }
  | { ok: false; message: string };
const periods = [
  { value: "daily", label: "Day" },
  { value: "weekly", label: "Week" },
  { value: "monthly", label: "Month" },
  { value: "yearly", label: "Year" },
] as const;
export function ReportsOverview({
  period,
  reportsResult,
}: {
  period: ReportPeriod;
  reportsResult: Result;
}) {
  const router = useRouter(),
    path = usePathname(),
    params = useSearchParams();
  const [pending, start] = useTransition();
  const reference = reportsResult.ok
    ? reportReference(reportsResult.report.metrics, period)
    : (params.get("date") ?? params.get("weekStart") ?? "");
  function change(value: ReportPeriod) {
    const next = new URLSearchParams(params);
    next.set("period", value);
    // Anchor the new period to the selected calendar date, never the current year.
    const anchor =
      period === "yearly"
        ? `${reference}-01-01`
        : period === "monthly"
          ? `${reference}-01`
          : reference;
    const converted =
      value === "yearly"
        ? anchor.slice(0, 4)
        : value === "monthly"
          ? anchor.slice(0, 7)
          : anchor;
    if (converted) next.set("date", converted);
    else next.delete("date");
    next.delete("weekStart");
    start(() => router.push(`${path}?${next}` as Route));
  }
  function changeDate(value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set("date", value);
    else next.delete("date");
    next.delete("weekStart");
    start(() => router.push(`${path}?${next}` as Route));
  }
  if (!reportsResult.ok)
    return (
      <div>
        <p role="status" className="rounded-xl border p-5 text-sm">
          Reading report unavailable. Retry this page or choose another period.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {periods.map((p) => (
            <button
              key={p.value}
              className="min-h-11 rounded-lg border px-4"
              aria-pressed={period === p.value}
              disabled={pending}
              onClick={() => change(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    );
  const r = reportsResult.report,
    m = r.metrics,
    active = m.heatmap.filter((x) => x.readingTimeSeconds > 0).length,
    hist = r.sessionLengthHistogram;
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
    (label, i) => ({
      label,
      minutes: Math.round(
        m.heatmap
          .filter(
            (d) => (new Date(`${d.date}T12:00Z`).getUTCDay() + 6) % 7 === i,
          )
          .reduce((n, d) => n + d.readingTimeSeconds, 0) / 60,
      ),
    }),
  );
  const timeline = groupTimeline(m.heatmap, period);
  const exportCsv = () => {
    const blob = new Blob([formatReportCsv(m.heatmap)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `matter-stats-${period}-${reference}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div aria-busy={pending} className={pending ? "opacity-60" : ""}>
      <p className="sr-only" role="status">
        {pending ? "Updating report…" : "Report loaded"}
      </p>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div
          role="group"
          aria-label="Report frequency"
          className="inline-flex flex-wrap rounded-xl border bg-card p-1"
        >
          {periods.map((p) => (
            <button
              key={p.value}
              disabled={pending}
              aria-pressed={period === p.value}
              onClick={() => change(p.value)}
              className={`min-h-11 rounded-lg px-4 text-sm ${period === p.value ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <form
          key={`${period}:${reference}`}
          onSubmit={(event) => {
            event.preventDefault();
            changeDate(
              String(new FormData(event.currentTarget).get("reference")),
            );
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="grid gap-1 text-sm">
            Report period
            <input
              required
              name="reference"
              aria-label="Specific report period"
              type={
                period === "yearly"
                  ? "text"
                  : period === "monthly"
                    ? "month"
                    : "date"
              }
              inputMode={period === "yearly" ? "numeric" : undefined}
              pattern={period === "yearly" ? "[0-9]{4}" : undefined}
              title={
                period === "yearly" ? "Enter a four-digit year" : undefined
              }
              defaultValue={reference}
              className="min-h-11 w-44 rounded-lg border bg-card px-3"
            />
          </label>
          <button
            disabled={pending}
            className="min-h-11 rounded-lg border bg-card px-4 text-sm"
          >
            Apply period
          </button>
        </form>
        <button
          onClick={exportCsv}
          className="min-h-11 rounded-lg border bg-card px-4 text-sm font-medium"
        >
          Export CSV
        </button>
      </div>
      <p className="mb-5 text-sm">
        <Link
          className="inline-flex min-h-11 items-center text-primary"
          href={`/year-in-reading?year=${reference.slice(0, 4)}`}
        >
          Explore your {reference.slice(0, 4)} annual recap →
        </Link>
      </p>
      <section className="border-b pb-8">
        <p className="text-sm text-primary">
          {m.heatmap[0]?.date ?? m.range.startDate} –{" "}
          {m.heatmap.at(-1)?.date ?? "No dates"} · {m.range.timezone}
        </p>
        {m.comparison.range && (
          <p className="mt-2 text-sm text-muted-foreground">
            Previous{" "}
            {period === "yearly"
              ? "year"
              : period === "monthly"
                ? "month"
                : period === "weekly"
                  ? "week"
                  : "day"}
            : {m.comparison.range.startDate} –{" "}
            {addCalendarDays(m.comparison.range.endDate, -1)}
          </p>
        )}
        <h2 className="mt-3 text-3xl font-semibold">Your {period} review</h2>
        <p className="mt-3 max-w-2xl font-serif text-lg leading-8 text-muted-foreground">
          You spent {dur(m.totals.totalReadingTimeSeconds)} reading across{" "}
          {active} active {active === 1 ? "day" : "days"}, in{" "}
          {m.totals.sessionsCount} imported sessions. Upstream historical
          coverage is unverified.
        </p>
      </section>
      <div className="grid border-b sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Reading time"
          value={dur(m.totals.totalReadingTimeSeconds)}
        />
        <Metric
          label="Estimated words"
          value={`≈${m.totals.wordsRead.toLocaleString()}`}
          note="Estimated from reading time at 225 words/min"
        />
        <Metric label="Active days" value={String(active)} />
        <Metric label="Sessions" value={String(m.totals.sessionsCount)} />
      </div>
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <Panel
          title="Reading over time"
          subtitle={
            period === "yearly"
              ? "Minutes per month"
              : period === "monthly"
                ? "Minutes per week"
                : "Minutes per day"
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timeline}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" />
              <YAxis unit="m" />
              <Tooltip />
              <Bar dataKey="minutes" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel
          title="Session length"
          subtitle="Number of sessions · non-overlapping ranges"
        >
          <div className="space-y-5 pt-3">
            {hist.map((x) => (
              <div
                className="flex items-center justify-between border-b pb-3"
                key={x.label}
              >
                <span>{x.label}</span>
                <strong>{x.count}</strong>
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title="Reading by weekday"
          subtitle="Total minutes · Monday first"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekdays}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" />
              <YAxis unit="m" />
              <Tooltip />
              <Bar dataKey="minutes" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}

function groupTimeline(
  days: ReportsClientPayload["metrics"]["heatmap"],
  period: ReportPeriod,
) {
  const buckets = new Map<string, number>();
  for (const day of days) {
    let key = day.date.slice(5);
    if (period === "yearly") key = day.date.slice(0, 7);
    if (period === "monthly") {
      const [year, month, date] = day.date.split("-").map(Number);
      const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
      key = `Week ${addCalendarDays(day.date, -((weekday + 6) % 7)).slice(5)}`;
    }
    buckets.set(key, (buckets.get(key) ?? 0) + day.readingTimeSeconds);
  }
  return [...buckets].map(([date, seconds]) => ({
    date,
    minutes: Math.round(seconds / 60),
  }));
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="p-5 sm:border-r">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="mb-5 text-sm text-muted-foreground">{subtitle}</p>
      <div className="h-72">{children}</div>
    </section>
  );
}
function dur(s: number) {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

function reportReference(
  metrics: ReportsClientPayload["metrics"],
  period: ReportPeriod,
) {
  const first = metrics.heatmap[0]?.date ?? metrics.range.startDate ?? "";
  return period === "yearly"
    ? first.slice(0, 4)
    : period === "monthly"
      ? first.slice(0, 7)
      : first;
}
