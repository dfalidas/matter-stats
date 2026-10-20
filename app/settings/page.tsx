import type { ReactNode } from "react";
import { requireAccessSession } from "@/lib/require-auth";
import { Clock3, Database, Globe2, LogOut, ShieldCheck, Tags } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_READING_SPEED_WORDS_PER_MINUTE } from "@/lib/matter-normalizers";
import { getDefaultMetricsTimezone } from "@/lib/metrics-service";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { unavailableSyncStatus, statusTimestamp, type Evidence, type SyncStatus } from "@/lib/sync-status";
import { loadSettingsStatus } from "@/lib/settings-status-service";
import { SyncStatusPanel } from "@/components/sync-status";
import { sanitizeSyncRunErrorMessage, type SyncRunLogEntry } from "@/lib/sync-run-log";
import { logout } from "@/lib/auth-actions";

import { PageShell } from "../_components/page-shell";
import { SyncMatterButton } from "../dashboard/sync-matter-button";

export const dynamic = "force-dynamic";

type ConnectionState = "connected" | "warning" | "error" | "not-configured";

type MatterConnectionStatus = {
  state: ConnectionState;
  label: string;
  detail: string;
};

type SettingsSyncData = {
  status: SyncStatus;
  recentRuns: Evidence<SyncRunLogEntry[]>;
  counts: Array<{ label: string; result: Evidence<number> }>;
};

export default async function SettingsPage() {
  await requireAccessSession();
  const now = new Date();
  const timezone = getDefaultMetricsTimezone();
  const syncData = await getSettingsSyncData(now, timezone);
  const matterStatus: MatterConnectionStatus = { state: process.env.MATTER_API_TOKEN ? "warning" : "not-configured", label: process.env.MATTER_API_TOKEN ? "Configured" : "Not configured", detail: "Server credential presence only. Connectivity is not checked by this status page." };

  return (
    <PageShell
      eyebrow="Settings"
      title="Sync and account settings"
      description="Inspect Matter connectivity, sync health, import counts, and dashboard assumptions without exposing private credentials."
    >
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <StatusCard
            title="Matter connection"
            description="Matter server credential configuration."
            status={matterStatus}
            icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
          />
          <StatusCard
            title="Database connection"
            description="Server-side Supabase admin access used for sync diagnostics."
            status={{ state: syncData.counts.every(c => c.result.state === "known") && !syncData.status.hasUnavailableSections ? "connected" : "warning", label: syncData.counts.every(c => c.result.state === "known") && !syncData.status.hasUnavailableSections ? "Reads available" : "Some reads unavailable", detail: "Each section reports its own availability. A failed query does not erase independent evidence." }}
            icon={<Database className="h-5 w-5" aria-hidden />}
          />
        </div>

        <Card className="border-dashboard-border bg-dashboard-card/80 shadow-soft backdrop-blur">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-dashboard-text">Matter sync health</CardTitle>
              <CardDescription className="mt-1 text-dashboard-muted">
                Recent activity sync is the default and imports sessions first, plus only the linked items needed for analytics. Use library backfill only when you intentionally want to fill older item metadata.
              </CardDescription>
            </div>
            <SyncMatterButton showBackfill timezone={timezone} />
          </CardHeader>
          <CardContent className="space-y-5">
            <SyncStatusPanel view={syncData.status.view} detailed />
          </CardContent>
        </Card>

        <Card className="border-dashboard-border bg-dashboard-card/80 shadow-soft backdrop-blur">
          <CardHeader>
            <CardTitle className="text-dashboard-text">Current data model</CardTitle>
            <CardDescription className="text-dashboard-muted">
              Reading-time analytics calculate canonical values from imported raw sessions. Imported-data freshness, persisted repair and upstream historical coverage are separate dimensions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-dashboard-muted">
              Source, author, tag and article attribution is unsupported for sessions without a documented item identifier. Another metadata sync is not guaranteed to resolve this.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {syncData.counts.map(c => <CountTile key={c.label} label={c.label} value={c.result.state === "known" ? c.result.value : null} helper="Raw persisted rows; no coverage guarantee" />)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-dashboard-border bg-dashboard-card/80 shadow-soft backdrop-blur">
          <CardHeader>
            <CardTitle className="text-dashboard-text">Recent sync runs</CardTitle>
            <CardDescription className="text-dashboard-muted">
              Invocation success can include partial ingestion. Unfinished logs do not prove a current worker. Legacy trigger evidence remains unknown; errors are redacted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {syncData.recentRuns.state === "known" ? <SyncRunLogTable runs={syncData.recentRuns.value} timezone={timezone} /> : <p role="status">Run history unavailable.</p>}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
          <Card className="border-dashboard-border bg-dashboard-card/80 shadow-soft backdrop-blur">
            <CardHeader>
              <CardTitle className="text-dashboard-text">Dashboard assumptions</CardTitle>
              <CardDescription className="text-dashboard-muted">
                These settings control local calendar grouping and fallback reading estimates.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <DiagnosticPanel
                label="Configured timezone"
                value={timezone}
                helper="Used for metric ranges, streaks, and calendar day boundaries."
                icon={<Globe2 className="h-4 w-4 text-sky-400" aria-hidden />}
              />
              <DiagnosticPanel
                label="Reading speed assumption"
                value={`${DEFAULT_READING_SPEED_WORDS_PER_MINUTE} words/min`}
                helper="Round each session duration / 60 × 225, then sum. Item word counts do not determine reading totals."
                icon={<Clock3 className="h-4 w-4 text-violet-400" aria-hidden />}
              />
            </CardContent>
          </Card>

          <Card className="border-dashboard-border bg-dashboard-card/80 shadow-soft backdrop-blur">
            <CardHeader>
              <CardTitle className="text-dashboard-text">Session</CardTitle>
              <CardDescription className="text-dashboard-muted">End access to this private dashboard on the current device.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={logout}>
                <Button type="submit" variant="outline" className="w-full border-white/10 bg-transparent hover:bg-white/[0.05]">
                  <LogOut className="h-4 w-4" aria-hidden /> Logout
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

function StatusCard({ title, description, status, icon }: { title: string; description: string; status: MatterConnectionStatus; icon: ReactNode }) {
  return (
    <Card className="border-dashboard-border bg-dashboard-card/80 shadow-soft backdrop-blur">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
              {icon}
            </span>
            <div>
              <CardTitle className="text-dashboard-text">{title}</CardTitle>
              <CardDescription className="mt-1 text-dashboard-muted">{description}</CardDescription>
            </div>
          </div>
          <Badge className={getStatusBadgeClass(status.state)}>{status.label}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-dashboard-muted">{status.detail}</p>
      </CardContent>
    </Card>
  );
}

function DiagnosticPanel({ label, value, helper, icon, tone = "default" }: { label: string; value: string; helper: string; icon: ReactNode; tone?: "default" | "warning" }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === "warning" ? "border-amber-400/20 bg-amber-400/5" : "border-dashboard-border bg-background/35"}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-dashboard-muted">
        {icon} {label}
      </div>
      <p className="mt-2 break-words text-lg font-semibold text-dashboard-text">{value}</p>
      <p className="mt-1 text-sm text-dashboard-muted">{helper}</p>
    </div>
  );
}

function CountTile({ label, value, helper = "Latest run" }: { label: string; value: number | null | undefined; helper?: string }) {
  return (
    <div className="rounded-2xl border border-dashboard-border bg-background/35 p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-dashboard-muted">
        <Tags className="h-3.5 w-3.5" aria-hidden /> {label}
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-dashboard-text">{value == null ? "Unavailable" : formatInteger(value)}</p>
      <p className="mt-1 text-sm text-dashboard-muted">{helper}</p>
    </div>
  );
}

function SyncRunLogTable({ runs, timezone }: { runs: SyncRunLogEntry[]; timezone: string }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-dashboard-border bg-background/25 p-6 text-sm text-dashboard-muted">
        No run history recorded. Unrecorded attempts remain unknown.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-dashboard-border hover:bg-transparent">
          <TableHead className="text-dashboard-muted">Started</TableHead>
          <TableHead className="text-dashboard-muted">Finished</TableHead>
          <TableHead className="text-dashboard-muted">Status</TableHead>
          <TableHead className="text-dashboard-muted">Trigger</TableHead>
          <TableHead className="text-right text-dashboard-muted">Sessions</TableHead>
          <TableHead className="text-right text-dashboard-muted">Linked items</TableHead>
          <TableHead className="min-w-[240px] text-dashboard-muted">Error message</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id} className="border-dashboard-border/70 hover:bg-white/[0.03]">
            <TableCell className="whitespace-nowrap text-dashboard-text">{run.started_at ? statusTimestamp(run.started_at, timezone) : "Unknown"}</TableCell>
            <TableCell className="whitespace-nowrap text-dashboard-text">{run.finished_at ? statusTimestamp(run.finished_at, timezone) : "Unknown"}</TableCell>
            <TableCell>
              <Badge className={getSyncRunStatusBadgeClass(run.status)}>{run.status === "success" ? "Invocation success" : run.status === "running" ? "Unfinished log" : formatStatus(run.status)}</Badge>
            </TableCell>
            <TableCell className="whitespace-nowrap text-dashboard-muted">Unknown</TableCell>
            <TableCell className="text-right tabular-nums text-dashboard-text">{formatInteger(run.sessions_synced)}</TableCell>
            <TableCell className="text-right tabular-nums text-dashboard-text">{formatInteger(run.items_synced)}</TableCell>
            <TableCell className="max-w-md break-words text-dashboard-muted">
              {run.status === "error" ? sanitizeSyncRunErrorMessage(run.error_message) : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

async function getSettingsSyncData(now: Date, timezone: string): Promise<SettingsSyncData> {
  const labels = ["Total reading sessions", "Sessions without linked item", "Total imported items", "Raw daily stats rows"];
  try {
    return await loadSettingsStatus(getSupabaseAdminClient(), now, timezone);
  } catch {
    return { status: unavailableSyncStatus(now, timezone), counts: labels.map(label => ({ label, result: { state: "unavailable" } })), recentRuns: { state: "unavailable" } };
  }
}

function getStatusBadgeClass(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "border-success/25 bg-success/10 text-success hover:bg-success/15";
    case "warning":
      return "border-warning/25 bg-warning/10 text-warning hover:bg-warning/15";
    case "error":
      return "border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15";
    case "not-configured":
      return "border-white/10 bg-muted text-muted-foreground hover:bg-muted";
  }
}

function getSyncRunStatusBadgeClass(status: string): string {
  switch (status) {
    case "success":
      return "border-success/25 bg-success/10 text-success hover:bg-success/15";
    case "running":
      return "border-primary/25 bg-primary/10 text-primary hover:bg-primary/15";
    case "error":
      return "border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15";
    default:
      return "border-white/10 bg-muted text-muted-foreground hover:bg-muted";
  }
}

function formatStatus(status: string): string {
  return status
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}
export const maxDuration = 180;
