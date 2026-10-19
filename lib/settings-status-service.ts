import type { MatterStatsSupabaseClient } from './supabase-queries';
import { loadSyncStatus, readStatusCount, readStatusEvidence } from './sync-status';

/** Each failure belongs only to its section; these reads never manufacture zero. */
export async function loadSettingsStatus(client: MatterStatsSupabaseClient, now: Date, timezone: string) {
  const labels = ['Total reading sessions', 'Sessions without linked item', 'Total imported items', 'Raw daily stats rows'];
  const [status, counts, recentRuns] = await Promise.all([
    loadSyncStatus(client, now, timezone),
    Promise.all([
      readStatusCount(client.from('reading_sessions').select('id', { count: 'exact', head: true })),
      readStatusCount(client.from('reading_sessions').select('id', { count: 'exact', head: true }).is('item_id', null)),
      readStatusCount(client.from('matter_items').select('id', { count: 'exact', head: true })),
      readStatusCount(client.from('daily_stats').select('date', { count: 'exact', head: true })),
    ]),
    readStatusEvidence(client.from('sync_runs').select('id,started_at,finished_at,status,items_synced,sessions_synced,error_message,sync_mode').order('started_at', { ascending: false }).limit(8)),
  ]);
  return { status, counts: labels.map((label, i) => ({ label, result: counts[i] })), recentRuns };
}
