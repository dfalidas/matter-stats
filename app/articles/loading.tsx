import { PageShell } from "../_components/page-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ArticlesLoading() {
  return (
    <PageShell
      eyebrow="Articles"
      title="Article library"
      description="Loading your searchable article history, filters, and reading metadata."
    >
      <div className="space-y-5">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="border-white/10 bg-background/55">
              <CardContent className="p-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-3 h-8 w-20" />
              </CardContent>
            </Card>
          ))}
        </section>

        <Card className="border-white/10 bg-background/55 shadow-soft">
          <CardHeader className="space-y-4">
            <Skeleton className="h-8 w-52" />
            <div className="grid gap-3 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1fr)]">
              <Skeleton className="h-10 w-full" />
              <div className="grid gap-2 md:grid-cols-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full rounded-xl" />
            ))}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
