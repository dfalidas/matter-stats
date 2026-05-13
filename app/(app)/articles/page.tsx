import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { RecentReads } from "@/components/dashboard/recent-reads";
import { getDashboardSummary } from "@/lib/data/dashboard";

export default async function ArticlesPage() {
  const summary = await getDashboardSummary();
  return <Card><CardHeader><CardTitle>Articles</CardTitle></CardHeader><RecentReads articles={summary.recentArticles} /></Card>;
}
