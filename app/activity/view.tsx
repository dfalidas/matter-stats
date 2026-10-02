"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { AwaitedActivity } from "./view-types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ActivityView({ data }: { data: AwaitedActivity }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const first = new Date(`${data.month}-01T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const dayCount = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const activityByDay = new Map(data.days.map((day) => [day.date, day]));

  function navigate(name: "month" | "day", value: string) {
    const next = new URLSearchParams(searchParams);
    next.set(name, value);
    next.delete("page");
    if (name === "month") next.delete("day");
    router.push(`/activity?${next}` as Route);
  }

  return (
    <div>
      <label className="mb-7 flex w-fit items-center gap-3 text-sm font-medium">
        Month
        <input
          type="month"
          value={data.month}
          onChange={(event) => navigate("month", event.target.value)}
          className="min-h-11 rounded-lg border bg-card px-3"
        />
      </label>
      <div className="grid grid-cols-7 gap-1" aria-label="Monthly reading calendar">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} className="py-2 text-center text-xs text-muted-foreground">{weekday}</span>
        ))}
        {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}
        {Array.from({ length: dayCount }, (_, index) => {
          const date = `${data.month}-${String(index + 1).padStart(2, "0")}`;
          const activity = activityByDay.get(date);
          const future = date > data.today;
          const detail = activity
            ? `, ${Math.round(activity.seconds / 60)} minutes, ${activity.sessions} sessions`
            : future ? ", future date" : ", no activity";
          return (
            <button
              key={date}
              disabled={future}
              onClick={() => navigate("day", date)}
              aria-label={`${date}${detail}`}
              aria-pressed={data.selectedDay === date}
              className={`aspect-square min-h-11 rounded-lg border p-1 text-left text-xs ${
                data.selectedDay === date ? "border-primary bg-primary/10" : activity ? "bg-primary/10" : "bg-card"
              } disabled:border-transparent disabled:bg-transparent disabled:text-muted-foreground/40`}
            >
              <span>{index + 1}</span>
              {activity && <span className="block text-center font-semibold text-primary">{Math.round(activity.seconds / 60)}m</span>}
            </button>
          );
        })}
      </div>
      <section className="mt-10 border-t pt-7">
        <h2 className="text-2xl font-semibold">
          {new Date(`${data.selectedDay}T12:00:00Z`).toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatDuration(data.dayTotal.seconds)} · ≈{data.dayTotal.estimatedWords.toLocaleString()} estimated words · {data.dayTotal.sessions} sessions
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Estimated from reading time at 225 words/min</p>
        <div className="mt-5 divide-y border-y">
          {data.sessions.length ? data.sessions.map((session) => (
            <article key={session.id} className="flex min-h-16 items-center justify-between gap-4 py-3">
              <div>
                <h3 className="font-medium">Reading session</h3>
                <p className="text-xs text-muted-foreground">
                  Session timestamp · {new Date(session.timestamp).toLocaleTimeString("en-GB", {
                    timeZone: data.timezone,
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium">{formatDuration(session.durationSeconds)}</p>
                <p className="text-xs text-muted-foreground">≈{session.estimatedWords.toLocaleString()} words</p>
              </div>
            </article>
          )) : <p className="py-8 text-sm text-muted-foreground">No reading activity on this day.</p>}
        </div>
        {data.totalPages > 1 && (
          <nav className="mt-5 flex items-center gap-3" aria-label="Session pages">
            <PageLink data={data} page={Math.max(1, data.page - 1)}>Previous</PageLink>
            <span className="text-sm text-muted-foreground">Page {data.page} of {data.totalPages}</span>
            <PageLink data={data} page={Math.min(data.totalPages, data.page + 1)}>Next</PageLink>
          </nav>
        )}
      </section>
    </div>
  );
}

function PageLink({ data, page, children }: { data: AwaitedActivity; page: number; children: React.ReactNode }) {
  return (
    <Link className="rounded-lg border px-4 py-3 text-sm" href={`/activity?month=${data.month}&day=${data.selectedDay}&page=${page}`}>
      {children}
    </Link>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
}
