import { Card } from "@/components/ui/card";
import type { DashboardMetric } from "@/lib/types/matter";

export function MetricCard({ metric }: { metric: DashboardMetric }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">{metric.label}</p>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-foreground">{metric.value}</p>
      {metric.delta ? <p className="mt-2 text-sm text-primary">{metric.delta}</p> : null}
    </Card>
  );
}
