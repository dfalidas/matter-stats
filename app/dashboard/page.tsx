import { PageShell } from "../_components/page-shell";

const metrics = [
  { label: "Articles read", value: "0", helper: "Awaiting your first import" },
  { label: "Reading time", value: "0h", helper: "Tracked across sessions" },
  { label: "Top source", value: "—", helper: "Ranked after sync" },
  { label: "Current streak", value: "0 days", helper: "Daily reading momentum" },
];

export default function DashboardPage() {
  return (
    <PageShell
      eyebrow="Dashboard"
      title="Your Matter reading command center"
      description="A placeholder overview for the private reading analytics dashboard. Future imports will populate these cards with article, source, author, tag, and reading-time trends."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <article key={metric.label} className="rounded-3xl border border-slate-200 bg-paper/70 p-5">
            <p className="text-sm font-medium text-slate-500">{metric.label}</p>
            <p className="mt-3 text-3xl font-bold text-ink">{metric.value}</p>
            <p className="mt-2 text-sm text-slate-500">{metric.helper}</p>
          </article>
        ))}
      </div>
      <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white/60 p-8 text-center text-slate-500">
        Reading charts and recent article activity will appear here.
      </div>
    </PageShell>
  );
}
