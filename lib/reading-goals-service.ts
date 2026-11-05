import type { MatterStatsSupabaseClient } from "./supabase-queries";
import { createAnalyticsQueryContext } from "./analytics-query-context";
import { currentGoalPeriod, goalProgress, parseGoalHours, type GoalType, type ReadingGoal } from "./reading-goals";

export async function loadReadingGoals(client: MatterStatsSupabaseClient, now: Date) {
  const periods = [currentGoalPeriod("weekly", now), currentGoalPeriod("yearly", now)];
  const context = createAnalyticsQueryContext(client);
  // Year contains the current week except at New Year; register larger read first.
  const reads = [...periods].reverse().map(async period => {
    try {
      const rows = await context.sessions(period.startUtc, now, "streak");
      return { type: period.type, seconds: rows.reduce((sum, row) => sum + (Number.isFinite(row.duration_seconds) ? Math.max(0, Math.round(row.duration_seconds!)) : 0), 0) };
    } catch { return { type: period.type, seconds: null }; }
  });
  return Promise.all(periods.map(async period => {
    let goal: ReadingGoal | null;
    try {
      const { data, error } = await client.from("reading_goals").select("type,period_start,target_seconds,enabled").eq("type", period.type).eq("period_start", period.start).maybeSingle();
      if (error) throw error;
      goal = data;
    } catch { return { period, state: "unavailable" as const, goal: null, progress: null }; }
    const actual = (await Promise.all(reads)).find(row => row.type === period.type)!.seconds;
    return { period, state: "available" as const, goal, progress: goal?.enabled && actual !== null ? goalProgress(goal.target_seconds, actual, period, now) : null };
  }));
}

export type GoalActionState = { ok: boolean; message: string } | null;
export async function mutateReadingGoal(deps: {
  authorize: () => Promise<void>;
  client: () => MatterStatsSupabaseClient;
  now: () => Date;
  refresh: () => void;
}, form: FormData): Promise<GoalActionState> {
  await deps.authorize();
  const type = form.get("type");
  if (type !== "weekly" && type !== "yearly") return { ok: false, message: "Unsupported goal type." };
  const period = currentGoalPeriod(type as GoalType, deps.now());
  if (form.get("periodStart") !== period.start) return { ok: false, message: "The period changed. Reload before saving." };
  const operation = form.get("operation");
  if (operation !== "save" && operation !== "disable") return { ok: false, message: "Unsupported goal operation." };
  const seconds = parseGoalHours(form.get("hours"));
  if (operation === "save" && seconds === null) return { ok: false, message: "Enter positive hours with at most two decimal places, within exact numeric limits." };
  try {
    const client = deps.client();
    const result = operation === "save"
      ? await client.from("reading_goals").upsert({ type, period_start: period.start, target_seconds: seconds!, enabled: true }, { onConflict: "type,period_start" })
      : await client.from("reading_goals").update({ enabled: false }).eq("type", type).eq("period_start", period.start);
    if (result.error) throw result.error;
    deps.refresh();
    return { ok: true, message: operation === "save" ? "Goal saved for this period." : "Goal disabled for this period." };
  } catch { return { ok: false, message: "Goal could not be saved. Your entry is retained; try again." }; }
}
