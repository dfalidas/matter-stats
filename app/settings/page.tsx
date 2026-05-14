import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Database, Globe2, LogOut, ShieldCheck, Tags } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_READING_SPEED_WORDS_PER_MINUTE } from "@/lib/matter-normalizers";
import { getDefaultMetricsTimezone } from "@/lib/metrics-service";
import type { SyncRun } from "@/lib/supabase-types";
import { logout } from "@/lib/auth-actions";

import { PageShell } from "../_components/page-shell";
import { SyncMatterButton } from "../dashboard/sync-matter-button";

const MATTER_ACCOUNT_URL = "https://api.getmatter.com/public/v1/me";

const sensitiveServerCredentialKeys = ["MATTER_API_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

type ConnectionState = "connected" | "warning" | "error" | "not-configured";

type MatterConnectionStatus = {
  state: ConnectionState;
  label: string;
  detail: string;
};

type SettingsSyncData = {
  latestRun: SyncRun | null;
  latestSuccessfulRun: Pick<SyncRun, "finished_at" | "started_at"> | null;
  latestErrorRun: Pick<SyncRun, "finished_at" | "started_at" | "error_message"> | null;
  databaseStatus: MatterConnectionStatus;
};

export default async function SettingsPage() {
  const [matterStatus, syncData] = await Promise.all([getMatterConnectionStatus(), getSettingsSyncData()]);
  const timezone = getDefaultMetricsTimezone();
  const latestRun = syncData.latestRun;

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
            description="Live server-side check against the Matter account endpoint."
            status={matterStatus}
            icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
          />
          <StatusCard
            title="Database connection"
            description="Server-side Supabase admin access used for sync diagnostics."
            status={syncData.databaseStatus}
            icon={<Database className="h-5 w-5" aria-hidden />}
          />
        </div>

        <Card className="border-dashboard-border bg-dashboard-card/80 shadow-soft backdrop-blur">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-dashboard-text">Matter sync health</CardTitle>
              <CardDescription className="mt-1 text-dashboard-muted">
                Use these values to confirm when the last import succeeded and whether the latest run failed.
              </CardDescription>
            </div>
            <SyncMatterButton />
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <DiagnosticPanel
                label="Last successful sync"
                value={formatTimestamp(syncData.latestSuccessfulRun?.finished_at ?? syncData.latestSuccessfulRun?.started_at)}
                helper="Recorded from the most recent successful sync run."
                icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />}
              />
              <DiagnosticPanel
                label="Last sync error"
                value={syncData.latestErrorRun?.error_message ?? "No sync errors recorded"}
                helper={syncData.latestErrorRun ? `Failed ${formatTimestamp(syncData.latestErrorRun.finished_at ?? syncData.latestErrorRun.started_at)}` : "The sync audit log has no failed run with an error message."}
                icon={<AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden />}
                tone={syncData.latestErrorRun ? "warning" : "default"}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <CountTile label="Items synced" value={latestRun?.items_synced} />
              <CountTile label="Sessions synced" value={latestRun?.sessions_synced} />
              <CountTile label="Annotations synced" value={latestRun?.annotations_synced} />
              <CountTile label="Tags synced" value={latestRun?.tags_synced} />
            </div>
            <p className="text-xs text-dashboard-muted">
              Counts reflect the latest sync run{latestRun ? ` (${latestRun.status})` : " once a run exists"}. Credentials are checked only for presence and health; secret values are never rendered.
            </p>
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
                helper="Used when Matter does not provide enough item facts to estimate words read."
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

function CountTile({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-2xl border border-dashboard-border bg-background/35 p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-dashboard-muted">
        <Tags className="h-3.5 w-3.5" aria-hidden /> {label}
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-dashboard-text">{formatInteger(value ?? 0)}</p>
      <p className="mt-1 text-sm text-dashboard-muted">Latest run</p>
    </div>
  );
}

async function getMatterConnectionStatus(): Promise<MatterConnectionStatus> {
  const token = process.env.MATTER_API_TOKEN;

  if (!token || token.trim().length === 0) {
    return {
      state: "not-configured",
      label: "Not configured",
      detail: "Matter API access is missing on the server, so manual syncs cannot run.",
    };
  }

  try {
    const response = await fetch(MATTER_ACCOUNT_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (response.ok) {
      return {
        state: "connected",
        label: "Connected",
        detail: "Matter accepted the configured server credential.",
      };
    }

    return {
      state: response.status === 429 ? "warning" : "error",
      label: response.status === 429 ? "Rate limited" : "Connection issue",
      detail: `Matter account check returned HTTP ${response.status}. Manual sync may fail until this is resolved.`,
    };
  } catch {
    return {
      state: "error",
      label: "Unreachable",
      detail: "Matter could not be reached from the server. Check outbound network access before syncing.",
    };
  }
}

async function getSettingsSyncData(): Promise<SettingsSyncData> {
  if (!hasServerDatabaseCredentials()) {
    return {
      latestRun: null,
      latestSuccessfulRun: null,
      latestErrorRun: null,
      databaseStatus: {
        state: "not-configured",
        label: "Not configured",
        detail: "Server-side database credentials are missing, so sync history cannot be loaded.",
      },
    };
  }

  try {
    const { getSupabaseAdminClient } = await import("@/lib/supabase-admin");
    const client = getSupabaseAdminClient();
    const [latestRunResult, latestSuccessfulRunResult, latestErrorRunResult] = await Promise.all([
      client.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      client
        .from("sync_runs")
        .select("finished_at, started_at")
        .eq("status", "success")
        .order("finished_at", { ascending: false, nullsFirst: false })
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("sync_runs")
        .select("finished_at, started_at, error_message")
        .eq("status", "error")
        .not("error_message", "is", null)
        .order("finished_at", { ascending: false, nullsFirst: false })
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const firstError = latestRunResult.error ?? latestSuccessfulRunResult.error ?? latestErrorRunResult.error;
    if (firstError) {
      throw firstError;
    }

    return {
      latestRun: latestRunResult.data,
      latestSuccessfulRun: latestSuccessfulRunResult.data,
      latestErrorRun: latestErrorRunResult.data,
      databaseStatus: {
        state: "connected",
        label: "Connected",
        detail: "Sync history loaded from Supabase using server-only access.",
      },
    };
  } catch {
    return {
      latestRun: null,
      latestSuccessfulRun: null,
      latestErrorRun: null,
      databaseStatus: {
        state: "error",
        label: "Connection issue",
        detail: "Sync history could not be read. Confirm database credentials and migrations before running sync.",
      },
    };
  }
}

function hasServerDatabaseCredentials(): boolean {
  return sensitiveServerCredentialKeys
    .filter((key) => key !== "MATTER_API_TOKEN")
    .every((key) => {
      const value = process.env[key];
      return Boolean(value && value.trim().length > 0);
    });
}

function getStatusBadgeClass(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15";
    case "warning":
      return "border-amber-400/25 bg-amber-400/10 text-amber-300 hover:bg-amber-400/15";
    case "error":
      return "border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15";
    case "not-configured":
      return "border-white/10 bg-muted text-muted-foreground hover:bg-muted";
  }
}

function formatTimestamp(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return "Never";
  }

  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}
