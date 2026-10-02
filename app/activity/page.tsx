import { PageShell } from "../_components/page-shell";
import { ActivityView } from "./view";
import {
  getActivityMonth,
  isCalendarDate,
  isCalendarMonth,
  normalizeActivityPage,
} from "@/lib/activity-service";
import { formatDateInTimezone, getDefaultMetricsTimezone } from "@/lib/metrics-service";
import { requireAccessSession } from "@/lib/require-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccessSession();
  const params = await searchParams;
  const value = (input: string | string[] | undefined) => Array.isArray(input) ? input[0] : input;
  const now = new Date();
  const currentMonth = formatDateInTimezone(now, getDefaultMetricsTimezone()).slice(0, 7);
  const candidateMonth = value(params?.month);
  const month = isCalendarMonth(candidateMonth) ? candidateMonth : currentMonth;
  const candidateDay = value(params?.day);
  const day = isCalendarDate(candidateDay) && candidateDay.startsWith(`${month}-`) ? candidateDay : null;

  try {
    const data = await getActivityMonth(
      getSupabaseAdminClient(),
      month,
      day,
      normalizeActivityPage(value(params?.page)),
      now,
    );
    return (
      <PageShell eyebrow="Activity" title="Reading activity" description={`Session activity in ${data.timezone}.`}>
        <ActivityView data={data} />
      </PageShell>
    );
  } catch (error) {
    return (
      <PageShell eyebrow="Activity" title="Reading activity" description="Activity data is currently unavailable.">
        <p className="rounded-xl border p-5 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Unable to load activity."}
        </p>
      </PageShell>
    );
  }
}
