import type { MatterStatsSupabaseClient } from './supabase-queries';
import { isCalendarDate } from './calendar';
import type { DailyStat, Json } from './supabase-types';

/** Construct once per request; all paged derived reads use the same pointer. */
export function createDerivedGenerationContext(client: MatterStatsSupabaseClient) {
  const generation = client.from('reading_generation_control').select('active').single()
    .then(({ data, error }) => {
      if (error) throw error;
      if (!data) throw new Error('Missing derived generation control');
      return data.active;
    });
  return { client, generation };
}
export type DerivedGenerationContext = ReturnType<typeof createDerivedGenerationContext>;

export async function readDerivedDays(client: MatterStatsSupabaseClient, since: string | null = null,
  context: DerivedGenerationContext = createDerivedGenerationContext(client)): Promise<DailyStat[]> {
  if (context.client !== client) throw new Error('Derived context belongs to another client');
  const generation = await context.generation;
  const rows: DailyStat[] = [];
  let after: string | null = null;
  for (;;) {
    const response: { data: Json[] | null; error: unknown } = await client.rpc('read_generation_days', {
      p_generation: generation, p_after: after, p_since: since, p_limit: 500,
    });
    const { data, error } = response;
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Invalid derived daily response');
    if (!data.length) return rows;
    for (const row of data) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.date !== 'string' || !isCalendarDate(row.date)
        || (after !== null && row.date <= after)) throw new Error('Non-advancing derived daily read');
      for (const field of ['reading_time_seconds', 'words_read', 'sessions_count']) {
        if (typeof row[field] !== 'number' || !Number.isSafeInteger(row[field]) || row[field] < 0) throw new Error('Unsafe derived aggregate');
      }
      rows.push(row as unknown as DailyStat);
      after = row.date;
    }
  }
}

export async function readDerivedEstimates(client: MatterStatsSupabaseClient, ids: string[], context: DerivedGenerationContext) {
  if (context.client !== client) throw new Error('Derived context belongs to another client');
  const { data, error } = await client.rpc('read_generation_estimates', { p_generation: await context.generation, p_ids: ids });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Invalid derived estimate response');
  const values = new Map<string, number | null>();
  for (const row of data) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string'
      || (row.words_estimated !== null && (typeof row.words_estimated !== 'number' || !Number.isSafeInteger(row.words_estimated) || row.words_estimated < 0))) {
      throw new Error('Invalid derived session estimate');
    }
    if (values.has(row.id) || !ids.includes(row.id)) throw new Error('Unexpected or duplicate derived session');
    values.set(row.id, row.words_estimated);
  }
  if (ids.some(id => !values.has(id))) throw new Error('Derived session generation incomplete for requested rows');
  return values;
}
