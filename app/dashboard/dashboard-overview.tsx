"use client";
import { chartTooltipStyle } from "@/components/chart-style";
import type { Evidence } from "@/lib/sync-status";
import type { Route } from "next";
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarDays, Clock3, Library, Timer } from "lucide-react";
import type { MetricsPeriodPreset } from "@/lib/metrics-service";
import type { MatterItem } from "@/lib/supabase-types";
import { formatOverviewRangeLabel } from "@/lib/overview-range";
import type { OverviewClientPayload } from "@/lib/overview-service";

type LibraryPreview = Pick<
  MatterItem,
  | "id"
  | "title"
  | "source"
  | "author"
  | "word_count"
  | "estimated_reading_time_minutes"
  | "progress"
  | "status"
>;
type Result =
  | {
      ok: true;
      metrics: OverviewClientPayload["metrics"];
      library: Evidence<LibraryPreview[]>;
    }
  | { ok: false; message: string; library: Evidence<LibraryPreview[]> };
const options = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "custom", label: "Custom" },
] as const;

export function DashboardOverview({
  period,
  metricsResult,
  fallbackDate,
}: {
  period: MetricsPeriodPreset | "custom";
  metricsResult: Result;
  fallbackDate: string;
}) {
  const router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams();
  const [pending, start] = useTransition();
  const m = metricsResult.ok ? metricsResult.metrics : null;
  const from = m?.range.startDate ?? params.get("start") ?? fallbackDate;
  const through = m?.heatmap.at(-1)?.date ?? params.get("end") ?? fallbackDate;
  function change(value: string) {
    const next = new URLSearchParams(params);
    if (value === "custom") {
      next.delete("period");
      next.set("start", from);
      next.set("end", through);
    } else {
      next.set("period", value);
      next.delete("start");
      next.delete("end");
    }
    start(() => router.push(`${pathname}?${next}` as Route));
  }
  const controls = (
    <>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">
            Your reading
          </h2>
          {m && (
            <p className="mt-1 text-sm text-muted-foreground">
              {formatOverviewRangeLabel(m)}
            </p>
          )}
        </div>
        <div
          className="inline-flex w-fit flex-wrap rounded-xl border bg-card p-1"
          role="group"
          aria-label="Analytics period"
        >
          {options.map((option) => (
            <button
              key={option.value}
              disabled={pending}
              aria-pressed={period === option.value}
              onClick={() => change(option.value)}
              className={`min-h-11 rounded-lg px-4 text-sm ${period === option.value ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {period === "custom" && (
        <form
          key={`${from}/${through}`}
          className="mb-8 flex flex-wrap items-end gap-3"
          action="/dashboard"
        >
          {[...params.entries()]
            .filter(([name]) => !["start", "end", "period"].includes(name))
            .map(([name, value], index) => (
              <input
                key={`${name}-${index}`}
                type="hidden"
                name={name}
                value={value}
              />
            ))}
          <label className="grid gap-1 text-sm">
            From
            <input
              required
              name="start"
              type="date"
              defaultValue={from}
              className="min-h-11 rounded-lg border bg-card px-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Through
            <input
              required
              name="end"
              type="date"
              defaultValue={through}
              className="min-h-11 rounded-lg border bg-card px-3"
            />
          </label>
          <button className="min-h-11 rounded-lg bg-foreground px-4 text-sm text-background">
            Apply dates
          </button>
        </form>
      )}
      <p className="sr-only" role="status">
        {pending ? "Updating reading period…" : "Reading period loaded"}
      </p>
    </>
  );
  if (!metricsResult.ok || !m)
    return (
      <div aria-busy={pending}>
        {controls}
        <State
          title="Reading data unavailable"
          detail={metricsResult.ok ? "Retry this page." : metricsResult.message}
        />
        <LibrarySection library={metricsResult.library} />
      </div>
    );
  const active = m.heatmap.filter((d) => d.readingTimeSeconds > 0).length;
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
    (label, index) => ({
      label,
      seconds: m.heatmap
        .filter(
          (d) =>
            (new Date(`${d.date}T12:00:00Z`).getUTCDay() + 6) % 7 === index,
        )
        .reduce((n, d) => n + d.readingTimeSeconds, 0),
    }),
  );
  return (
    <div aria-busy={pending} className={pending ? "opacity-60" : ""}>
      {controls}
      {m.totals.sessionsCount === 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          No imported reading sessions in this period. Upstream coverage is
          unverified; this does not establish no reading in Matter.
        </p>
      )}
      <div className="grid border-y sm:grid-cols-2 lg:grid-cols-4">
        {" "}
        <Metric
          icon={Clock3}
          label="Reading time"
          value={duration(m.totals.totalReadingTimeSeconds)}
          prominent
        />
        <Metric
          icon={Library}
          label="Estimated words"
          value={`≈${m.totals.wordsRead.toLocaleString()}`}
          hint="Estimated from reading time at 225 words/min"
        />
        <Metric
          icon={CalendarDays}
          label="Active days"
          value={String(active)}
        />
        <Metric
          icon={Timer}
          label="Sessions"
          value={m.totals.sessionsCount.toLocaleString()}
        />
      </div>
      <div className="mt-10 grid gap-10 lg:grid-cols-[1.7fr_1fr]">
        <Chart title="Reading rhythm" detail="Daily reading time · minutes">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={m.heatmap.map((d) => ({
                date: d.date.slice(5),
                minutes: Math.round(d.readingTimeSeconds / 60),
              }))}
            >
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                stroke="hsl(var(--muted-foreground))"
                dataKey="date"
                tickLine={false}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                unit="m"
                tickLine={false}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(v) => [`${v} min`, "Reading time"]}
              />
              <Bar
                dataKey="minutes"
                fill="hsl(var(--primary))"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </Chart>
        <Chart title="Reading by weekday" detail="Total time · Monday first">
          <div className="space-y-4 pt-3">
            {weekdays.map((d) => (
              <div
                key={d.label}
                className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 text-sm"
              >
                <span>{d.label}</span>
                <span className="h-2 rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.max(2, (d.seconds / Math.max(...weekdays.map((x) => x.seconds), 1)) * 100)}%`,
                    }}
                  />
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {duration(d.seconds)}
                </span>
              </div>
            ))}
          </div>
        </Chart>
      </div>
      <LibrarySection library={metricsResult.library} />
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  hint,
  prominent,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  hint?: string;
  prominent?: boolean;
}) {
  return (
    <div className="border-b p-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p
        className={`mt-3 font-semibold tracking-tight ${prominent ? "text-4xl" : "text-3xl"}`}
      >
        {value}
      </p>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
function Chart({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="mb-5 text-sm text-muted-foreground">{detail}</p>
      <div className="h-72">{children}</div>
    </section>
  );
}
function State({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border bg-card p-8">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
function duration(s: number) {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

function LibrarySection({ library }: { library: Evidence<LibraryPreview[]> }) {
  return (
    <section className="mt-10 border-t pt-7">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold">From your library</h3>
          <p className="text-sm text-muted-foreground">
            Current library · Independent of selected period
          </p>
        </div>
        <Link href="/articles" className="text-sm font-medium text-primary">
          View library →
        </Link>
      </div>
      <div className="mt-5 divide-y border-y">
        {library.state !== "known" ? (
          <p className="py-6 text-sm text-muted-foreground">
            Library query unavailable. Imported metadata could not be checked.
          </p>
        ) : library.value.length ? (
          library.value.map((item) => (
            <Link
              key={item.id}
              href={`/articles/${encodeURIComponent(item.id)}`}
              className="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div>
                <h4 className="font-medium">{item.title ?? "Untitled item"}</h4>
                <p className="text-sm text-muted-foreground">
                  {item.source ?? item.author ?? "Source unavailable"} ·{" "}
                  {item.status ?? "Status unavailable"}
                </p>
              </div>
              <div className="text-sm text-muted-foreground sm:text-right">
                <p>
                  {item.word_count == null
                    ? "Size unknown"
                    : `≈${item.word_count.toLocaleString()} words`}
                </p>
                <p>
                  {item.progress == null
                    ? "Progress unavailable"
                    : `${Math.round(item.progress * 100)}% progress`}
                </p>
              </div>
            </Link>
          ))
        ) : (
          <p className="py-6 text-sm text-muted-foreground">
            No imported library items are stored.
          </p>
        )}
      </div>
    </section>
  );
}
