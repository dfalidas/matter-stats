/** Complete metadata reads only; callers supply fresh queries and stable ordering. */
type MetadataQuery = PromiseLike<{ data: unknown; error: unknown }> & {
  range(from: number, to: number): MetadataQuery;
};

export const METADATA_PAGE_SIZE = 500;
// Reserve room for the fixed projections, date filters, ordering and pagination.
// Encode with URLSearchParams, exactly as the installed PostgREST builder does.
const ID_FILTER_BYTES = 6000;
const ID_BATCH_SIZE = 100;

export function quotePostgrest(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function postgrestIn(ids: readonly string[]): string {
  return `(${ids.map(quotePostgrest).join(",")})`;
}

export function metadataIdentity(row: unknown, keys: readonly string[]): string {
  if (!row || typeof row !== "object") throw new Error("Invalid complete-metadata row");
  const values = keys.map((key) => (row as Record<string, unknown>)[key]);
  if (values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("Invalid complete-metadata identity");
  }
  return JSON.stringify(values);
}

/**
 * Live offset enumeration, not a snapshot. Only an empty successful page proves
 * exhaustion. Advance by actual database rows, including server-capped pages.
 * Stable ordering must end in the full unique key (item_tags has two columns).
 * Concurrent deletes can shift unseen rows; inserts/updates can cause a repeat,
 * which rejects the whole read. See docs/task-17-validation.md.
 */
export async function readCompleteMetadata<Row>(
  createQuery: () => MetadataQuery,
  keys: readonly string[] = ["id"],
): Promise<Row[]> {
  const rows: Row[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    const { data, error } = await createQuery().range(offset, offset + METADATA_PAGE_SIZE - 1);
    if (error) throw error;
    if (!Array.isArray(data) || data.length > METADATA_PAGE_SIZE) throw new Error("Invalid complete-metadata response");
    if (!data.length) return rows;
    for (const row of data) {
      const identity = metadataIdentity(row, keys);
      if (seen.has(identity)) throw new Error("Duplicate or non-advancing complete-metadata response");
      seen.add(identity);
      rows.push(row as Row);
    }
    offset += data.length;
    if (!Number.isSafeInteger(offset)) throw new Error("Invalid complete-metadata offset");
  }
}

/** Deduplicate IDs, bound their encoded filter size, and completely read every batch. */
export async function readIdBatches<Row>(
  ids: readonly string[],
  readBatch: (ids: string[]) => Promise<Row[]>,
  keys: readonly string[] = ["id"],
): Promise<Row[]> {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  let batch: string[] = [];
  for (const id of unique) {
    if (typeof id !== "string" || !id.trim()) throw new Error("Invalid complete-metadata input ID");
    const fits = (values: string[]) => new URLSearchParams({ item_id: `in.${postgrestIn(values)}` }).toString().length <= ID_FILTER_BYTES;
    if (!fits([id])) throw new Error("Complete-metadata input ID exceeds encoded filter budget");
    if (batch.length === ID_BATCH_SIZE || !fits([...batch, id])) {
      batches.push(batch);
      batch = [];
    }
    batch.push(id);
  }
  if (batch.length) batches.push(batch);
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const values of batches) {
    for (const row of await readBatch(values)) {
      const identity = metadataIdentity(row, keys);
      if (seen.has(identity)) throw new Error("Duplicate complete-metadata batch response");
      seen.add(identity);
      rows.push(row);
    }
  }
  return rows;
}
