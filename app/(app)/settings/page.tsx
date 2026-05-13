import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  return (
    <Card className="max-w-3xl">
      <h1 className="text-3xl font-semibold">Settings</h1>
      <p className="mt-3 text-muted-foreground">Manual sync is first. Matter and Supabase secrets remain server-side only.</p>
      <form action="/api/sync" method="post" className="mt-6">
        <Button type="submit">Run manual sync</Button>
      </form>
    </Card>
  );
}
