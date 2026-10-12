/** The factory must preserve caller filters/projection and return a fresh query. */
type SessionQuery = PromiseLike<{ data: unknown; error: unknown }> & {
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): SessionQuery;
  limit(count: number): SessionQuery;
  or(filters: string): SessionQuery;
};

type SessionKey = { id: string; started_at: string | null };
const PAGE_SIZE = 500;

/**
 * Live keyset enumeration, fenced by the greatest matching key read first.
 * Only a successful empty query proves exhaustion; a server-capped short page
 * does not. This is NOT an MVCC snapshot. See docs/task-16-validation.md.
 */
export async function readCompleteSessions<Row extends SessionKey>(
  createQuery: () => SessionQuery,
): Promise<Row[]> {
  const boundary = await readPage<Row>(createQuery()
    .order("started_at", { ascending: false, nullsFirst: true })
    .order("id", { ascending: false }).limit(1));
  if (boundary.length === 0) return [];
  if (boundary.length !== 1) throw new Error("Invalid complete-session boundary response");
  const upper = boundary[0];
  validateKey(upper);
  let upperFilter = atOrBefore(upper);
  if (upper.started_at === null) {
    // Nulls sort last. Pin the dated segment separately, otherwise a null upper
    // key would admit an unbounded stream of new dated rows during traversal.
    const dated = await readPage<Row>(createQuery().or("started_at.not.is.null")
      .order("started_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false }).limit(1));
    if (dated.length > 1) throw new Error("Invalid complete-session boundary response");
    if (dated.length) validateKey(dated[0]);
    upperFilter = `and(started_at.is.null,id.lte.${quoted(upper.id)})`;
    if (dated.length) upperFilter += `,and(started_at.not.is.null,or(${atOrBefore(dated[0])}))`;
  }

  const rows: Row[] = [];
  const seen = new Set<string>();
  let cursor: SessionKey | null = null;
  for (;;) {
    const filters: string = cursor
      ? `and(or(${after(cursor)}),or(${upperFilter}))`
      : upperFilter;
    const page: Row[] = await readPage<Row>(createQuery().or(filters)
      .order("started_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }).limit(PAGE_SIZE));
    if (page.length === 0) return rows;
    for (const row of page) {
      validateKey(row);
      // Reject repeats rather than double-counting or returning a partial total.
      // Also catches servers that ignore the cursor and make no forward progress.
      if (seen.has(row.id)) throw new Error("Duplicate or non-advancing complete-session response");
      seen.add(row.id);
      rows.push(row);
    }
    cursor = page[page.length - 1];
  }
}

async function readPage<Row>(query: SessionQuery): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Invalid complete-session response");
  return data as Row[];
}

function validateKey(row: SessionKey) {
  if (!row || typeof row.id !== "string" || !row.id.trim()
    || (row.started_at !== null && !isTimestamp(row.started_at))) {
    throw new Error("Invalid complete-session pagination key");
  }
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10);
}

// PostgREST quoted filter values escape both quotes and backslashes. Keep the
// database timestamp verbatim: JS Date normalization would lose microseconds.
function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function after(key: SessionKey): string {
  const id = quoted(key.id);
  return key.started_at === null
    ? `and(started_at.is.null,id.gt.${id})`
    : `started_at.gt.${quoted(key.started_at)},and(started_at.eq.${quoted(key.started_at)},id.gt.${id}),started_at.is.null`;
}

function atOrBefore(key: SessionKey): string {
  const id = quoted(key.id);
  return key.started_at === null
    ? `started_at.not.is.null,and(started_at.is.null,id.lte.${id})`
    : `started_at.lt.${quoted(key.started_at)},and(started_at.eq.${quoted(key.started_at)},id.lte.${id})`;
}
