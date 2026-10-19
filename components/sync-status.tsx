import Link from "next/link";
import type { StatusView } from "@/lib/sync-status";

/** Both surfaces receive the same server-derived interpretation and safe text. */
export function SyncStatusPanel({
  view,
  detailed = false,
}: {
  view: StatusView;
  detailed?: boolean;
}) {
  const compactLabels = [
    "Last completed sessions cycle",
    "Last completed metadata cycle",
    "Ingestion / continuation",
    "Persisted derived readiness",
  ];
  return (
    <section
      aria-label="Synchronization status"
      className={`mb-7 rounded-xl border bg-card p-4 text-sm ${view.warning ? "border-amber-500/50" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Synchronization status</h2>
          <p className="mt-1" role="status">
            {view.summary}
          </p>
        </div>
        {!detailed && (
          <Link href="/settings" className="font-medium text-primary">
            View data status →
          </Link>
        )}
      </div>
      <dl
        className={`mt-4 grid gap-4 ${detailed ? "sm:grid-cols-2" : "lg:grid-cols-2"}`}
      >
        {view.details
          .filter((d) => detailed || compactLabels.includes(d.label))
          .map((d) => (
            <div className="min-w-0" key={d.label}>
              <dt className="text-muted-foreground">
                {detailed ? d.label : compactLabel(d.label)}
              </dt>
              <dd className="mt-1 break-words">
                {detailed ? d.value : compactValue(d.value)}
              </dd>
            </div>
          ))}
      </dl>
      {!detailed && (
        <p className="mt-3 text-muted-foreground">
          Reading totals use imported sessions. Import freshness, saved
          calculations and upstream history coverage are separate.
        </p>
      )}
    </section>
  );
}

function compactLabel(label: string) {
  return label === "Persisted derived readiness"
    ? "Saved calculations"
    : label === "Ingestion / continuation"
      ? "Import progress"
      : label;
}
function compactValue(value: string) {
  return value
    .replaceAll("recent_sessions", "reading sessions")
    .replaceAll("library_items", "library metadata")
    .replaceAll("current_year", "current year")
    .replaceAll("pending dirty rollups", "Updates pending")
    .replaceAll("historical repair", "Historical recalculation");
}
