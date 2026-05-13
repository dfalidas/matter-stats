import { PageShell } from "../_components/page-shell";
import { DashboardOverview } from "./dashboard-overview";

export default function DashboardPage() {
  return (
    <PageShell
      eyebrow="Dashboard"
      title="Your Matter reading command center"
      description="A private reading analytics dashboard scaffolded with dark-first shadcn/ui primitives, Recharts visualization space, and Supabase-ready data access."
    >
      <DashboardOverview />
    </PageShell>
  );
}
