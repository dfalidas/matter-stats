import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { getDashboardSummary } from "@/lib/data/dashboard";

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const summary = await getDashboardSummary();
  const article = summary.recentArticles.find((item) => item.id === id);

  if (!article) notFound();

  return (
    <Card className="max-w-3xl">
      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">{article.source ?? "Unknown source"}</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">{article.title}</h1>
      <p className="mt-4 text-muted-foreground">By {article.author ?? "Unknown author"} · {article.readingTimeMinutes} min · {article.wordCount.toLocaleString()} words</p>
      <div className="mt-6 flex flex-wrap gap-2">{article.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">#{tag}</span>)}</div>
    </Card>
  );
}
