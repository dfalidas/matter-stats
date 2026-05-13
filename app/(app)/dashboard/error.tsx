"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <Card className="max-w-2xl">
      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">Dashboard unavailable</p>
      <h1 className="mt-3 text-3xl font-semibold">Unable to load reading analytics</h1>
      <p className="mt-3 text-muted-foreground">Check your Supabase configuration and try again. Secrets are never sent to the browser.</p>
      <Button type="button" className="mt-6" onClick={reset}>Try again</Button>
    </Card>
  );
}
