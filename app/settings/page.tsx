import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/supabase";

import { PageShell } from "../_components/page-shell";

export default function SettingsPage() {
  return (
    <PageShell
      eyebrow="Settings"
      title="Configure your private dashboard"
      description="Placeholder settings for a single-user Matter Stats installation, including import credentials, display preferences, and privacy controls."
    >
      <Card className="border-white/10 bg-background/45">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Supabase connection</CardTitle>
              <CardDescription>Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable the browser client.</CardDescription>
            </div>
            <Badge variant={isSupabaseConfigured ? "default" : "secondary"}>
              {isSupabaseConfigured ? "Configured" : "Not configured"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The shared client lives in <code className="rounded bg-muted px-1 py-0.5 text-foreground">@/lib/supabase</code> and returns
          <code className="rounded bg-muted px-1 py-0.5 text-foreground"> null</code> until environment variables are present.
        </CardContent>
      </Card>
    </PageShell>
  );
}
