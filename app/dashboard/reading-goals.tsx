"use client";
import { useActionState, useState } from "react";
import { goalHoursInput } from "@/lib/reading-goals";
import { saveReadingGoal } from "./goal-actions";
import type { loadReadingGoals } from "@/lib/reading-goals-service";

type GoalView = Awaited<ReturnType<typeof loadReadingGoals>>[number];
const hours = (seconds: number) => `${(seconds / 3600).toLocaleString("en-GB", { maximumFractionDigits: 2 })} h`;

export function ReadingGoals({ goals }: { goals: GoalView[] }) {
  return <section aria-labelledby="reading-goals-title" className="space-y-3 rounded-xl border bg-card p-5">
    <h2 id="reading-goals-title" className="font-semibold">Reading goals</h2>
    <p className="text-sm text-muted-foreground">Current calendar periods · Europe/Athens · independent of the Overview filter.</p>
    <p className="text-sm text-muted-foreground">Based on imported sessions; coverage incomplete or unverified. Missing history may overstate the remaining effort. These values are not a forecast.</p>
    <div className="grid gap-4 md:grid-cols-2">{goals.map(view => <GoalCard key={`${view.period.type}-${view.period.start}`} view={view} />)}</div>
  </section>;
}

function GoalCard({ view }: { view: GoalView }) {
  const { period, state, goal, progress } = view;
  const label = period.type === "weekly" ? "Weekly" : "Yearly";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(goal ? goalHoursInput(goal.target_seconds) : "");
  const [result, action, pending] = useActionState(saveReadingGoal, null);
  return <article aria-label={`${label} reading goal`} className="space-y-3 rounded-lg border p-4">
    <h3 className="font-medium">{label} goal</h3>
    <p className="text-xs text-muted-foreground">{period.start} to {period.end} (exclusive) · Europe/Athens</p>
    {state === "unavailable" ? <p role="alert">Goal unavailable. Reload to try again.</p> : <>
      {goal?.enabled ? <>
        <p className="font-medium">Target {hours(goal.target_seconds)}</p>
        {progress ? <>
          <p>{hours(progress.actualSeconds)} read · {progress.percent.toLocaleString("en-GB", { maximumFractionDigits: 1 })}% achieved</p>
          <div role="progressbar" aria-label={`${label} goal progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.barPercent} aria-valuetext={`${progress.percent.toFixed(1)}% achieved`} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${progress.barPercent}%` }} /></div>
          <p>{hours(progress.remainingSeconds)} remaining{progress.remainingSeconds === 0 ? " · Goal reached" : ""}</p>
          <p className="text-sm">{progress.ended ? "Period ended" : `${Math.ceil(progress.requiredSecondsPerDay / 60)} min/day needed`}</p>
          <p className="text-xs text-muted-foreground">Average needed per remaining day, including the rest of today.</p>
        </> : <p role="alert">Reading progress unavailable. Reload to try again.</p>}
      </> : <p className="text-sm text-muted-foreground">{goal ? "Goal disabled for this period." : "No goal set."}</p>}
      {!editing && <button type="button" onClick={() => setEditing(true)} className="min-h-11 rounded-lg border px-3 text-sm">{goal?.enabled ? "Edit goal" : goal ? "Re-enable goal" : "Set goal"}</button>}
      {editing && <form action={action} className="space-y-3">
        <input type="hidden" name="type" value={period.type} /><input type="hidden" name="periodStart" value={period.start} />
        <label className="grid gap-1 text-sm">{label} target in hours<input name="hours" type="text" inputMode="decimal" autoComplete="off" value={value} onChange={event => setValue(event.target.value)} aria-describedby={`${period.type}-precision`} className="min-h-11 w-full rounded-lg border bg-background px-3" /></label>
        <p id={`${period.type}-precision`} className="text-xs text-muted-foreground">Positive hours, up to two decimal places (0.01 h = 36 seconds).</p>
        <div className="flex flex-wrap gap-2">
          <button name="operation" value="save" disabled={pending} className="min-h-11 rounded-lg bg-foreground px-3 text-sm text-background disabled:opacity-50">{pending ? "Saving…" : goal && !goal.enabled ? "Save and re-enable" : "Save goal"}</button>
          {goal?.enabled && <button name="operation" value="disable" disabled={pending} className="min-h-11 rounded-lg border px-3 text-sm disabled:opacity-50">Disable goal</button>}
          <button type="button" disabled={pending} onClick={() => setEditing(false)} className="min-h-11 rounded-lg border px-3 text-sm">Close</button>
        </div>
      </form>}
      <p role="status" aria-live="polite" className={`text-sm ${result?.ok === false ? "text-destructive" : "text-muted-foreground"}`}>{result?.message}</p>
    </>}
  </article>;
}
