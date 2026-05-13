import Link from "next/link";
import type { Article } from "@/lib/types/matter";

export function RecentReads({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">No reads synced yet. Run a manual sync from Settings to populate this list.</p>;
  }

  return (
    <div className="divide-y divide-border">
      {articles.map((article) => (
        <Link key={article.id} href={`/articles/${article.id}`} className="block py-4 first:pt-0 last:pb-0">
          <p className="font-medium text-foreground transition hover:text-primary">{article.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {article.source ?? "Unknown source"} · {article.readingTimeMinutes} min · {article.wordCount.toLocaleString()} words
          </p>
        </Link>
      ))}
    </div>
  );
}
