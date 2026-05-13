import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RankedList } from "@/components/dashboard/ranked-list";
import { ReadingChart } from "@/components/dashboard/reading-chart";
import { RecentReads } from "@/components/dashboard/recent-reads";
import { getDashboardSummary } from "@/lib/data/dashboard";

export default async function DashboardPage() {
  const summary = await getDashboardSummary();

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-primary">Reading command center</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground md:text-5xl">Your Matter reading pulse</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">Daily, weekly, monthly, yearly, and all-time analytics will read from Supabase after each sync.</p>
        </div>
        <div className="rounded-3xl border border-border bg-card/70 px-5 py-4 text-sm text-muted-foreground">
          Current streak <span className="ml-2 text-2xl font-semibold text-foreground">{summary.currentStreakDays} days</span>
          <span className="ml-4 text-primary">Best {summary.bestStreakDays}</span>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summary.metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Reading time this week</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Minutes read by day, ready for Supabase-backed trends.</p>
            </div>
          </CardHeader>
          <ReadingChart data={summary.trends} />
        </Card>
        <Card>
          <CardHeader><CardTitle>Top sources</CardTitle></CardHeader>
          <RankedList items={summary.topSources} />
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Top authors</CardTitle></CardHeader>
          <RankedList items={summary.topAuthors} />
        </Card>
        <Card>
          <CardHeader><CardTitle>Top tags</CardTitle></CardHeader>
          <RankedList items={summary.topTags} />
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent reads</CardTitle></CardHeader>
          <RecentReads articles={summary.recentArticles} />
        </Card>
      </section>
    </div>
  );
}
