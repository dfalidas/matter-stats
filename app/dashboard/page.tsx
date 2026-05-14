import { PageShell } from "../_components/page-shell";
import { DashboardOverview } from "./dashboard-overview";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { getDashboardSummary, getReadingTrend } from "@/lib/supabase-queries";

export default async function DashboardPage() {
  const client = getSupabaseAdminClient();
  const [summary, readingTrend] = await Promise.all([getDashboardSummary(client), getReadingTrend(client, 7)]);

  return (
    <PageShell
      eyebrow="Dashboard"
      title="Your Matter reading command center"
      description="A private reading analytics dashboard scaffolded with dark-first shadcn/ui primitives, Recharts visualization space, and Supabase-ready data access."
    >
      <DashboardOverview summary={summary} readingTrend={readingTrend} />
    </PageShell>
  );
}
