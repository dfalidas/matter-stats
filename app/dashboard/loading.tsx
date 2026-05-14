import { PageShell } from "../_components/page-shell";
import { LoadingSkeleton } from "@/components/dashboard-components";

export default function DashboardLoading() {
  return (
    <PageShell
      eyebrow="Dashboard"
      title="Matter Stats"
      description="Loading your private reading analytics from Supabase."
    >
      <div className="space-y-6">
        <LoadingSkeleton rows={2} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <LoadingSkeleton rows={1} />
          <LoadingSkeleton rows={1} />
          <LoadingSkeleton rows={1} />
          <LoadingSkeleton rows={1} />
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
          <LoadingSkeleton variant="chart" rows={3} />
          <LoadingSkeleton variant="list" rows={4} />
        </div>
      </div>
    </PageShell>
  );
}
