// Independent, explicit UTC/local-date contract vectors. No app aggregation,
// calendar, normalization or test-build helpers are imported here.
export const sessions = [
  ["three-a", "2025-01-01T22:00:00Z", "2025-01-02", 60],
  ["three-b", "2025-01-02T10:00:00Z", "2025-01-02", 60],
  ["three-c", "2025-01-02T21:59:59Z", "2025-01-02", 60],
  ["exclusive", "2025-01-02T22:00:00Z", "2025-01-03", 120],
  ["monday", "2024-12-29T22:00:00Z", "2024-12-30", 1],
  ["week-exclusive", "2025-01-05T22:00:00Z", "2025-01-06", 120],
  ["february", "2025-02-23T22:00:00Z", "2025-02-24", 61],
  ["march", "2025-03-01T12:00:00Z", "2025-03-01", 1],
  ["leap", "2024-02-29T12:00:00Z", "2024-02-29", 60],
  ["dst-before", "2025-03-30T00:59:59Z", "2025-03-30", 1],
  ["dst-after", "2025-03-30T01:00:00Z", "2025-03-30", 1],
  ["dst-end", "2025-03-30T21:00:00Z", "2025-03-31", 1],
  ["fall-before", "2025-10-26T00:59:59Z", "2025-10-26", 1],
  ["fall-after", "2025-10-26T01:00:00Z", "2025-10-26", 1],
  ["fall-end", "2025-10-26T22:00:00Z", "2025-10-27", 1],
  ["year-end", "2025-12-31T21:59:59Z", "2025-12-31", 1],
  ["year-start", "2025-12-31T22:00:00Z", "2026-01-01", 1],
  ["zero", "2025-01-04T10:00:00Z", "2025-01-04", 0],
  ...Array.from({ length: 25 }, (_, i) => [
    `pagination-${i}`,
    `2025-04-01T00:${String(i).padStart(2, "0")}:00Z`,
    "2025-04-01",
    1,
  ]),
].map(([id, timestamp, day, seconds]) => ({
  id: `task24-${id}`,
  timestamp,
  day,
  seconds,
}));

export function expectedRows(first, last) {
  const result = [];
  for (
    let date = new Date(`${first}T12:00:00Z`);
    date.toISOString().slice(0, 10) <= last;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const day = date.toISOString().slice(0, 10);
    const rows = sessions.filter((row) => row.day === day);
    result.push([
      day,
      rows.reduce((n, r) => n + r.seconds, 0),
      rows.reduce((n, r) => n + Math.round((r.seconds / 60) * 225), 0),
      rows.length,
    ]);
  }
  return result;
}

export const seedSql = `
insert into public.matter_items(id,title,source,author,content_type,status,word_count,progress,created_at_matter,updated_at_matter)
select 'task24-item-'||lpad(i::text,3,'0'), case when i=0 then null else 'Synthetic article '||lpad(i::text,3,'0') end,
  'Synthetic journal',case when i%2=1 then 'Sample author' else null end,'article',case when i%2=1 then 'queue' else 'archive' end,
  case when i=0 then null when i=2 then 0 else 999999 end,case when i=0 then null else 0 end,
  timestamptz '2025-01-01T10:00:00Z',timestamptz '2025-01-01T10:00:00Z'
from generate_series(0,104) i;
insert into public.matter_tags(id,name) values('task24-tag','Synthetic science');
insert into public.item_tags(item_id,tag_id) values('task24-item-001','task24-tag');
insert into public.reading_sessions(id,started_at,duration_seconds,item_id,words_estimated)
values ${sessions.map((r) => `('${r.id}','${r.timestamp}',${r.seconds},null,999999)`).join(",")};
`;

export function syntheticMatter(request, state) {
  const { path, query } = request;
  if (path === "/public/v1/me")
    return {
      kind: "synthetic",
      body: { object: "account", id: "task24-synthetic-account" },
    };
  if (path === "/public/v1/reading_sessions") {
    const offset = Number(
      (query.cursor ?? "task24-page-0").replace("task24-page-", ""),
    );
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 19 ||
      Object.keys(query).some(
        (key) => !["cursor", "limit", "since"].includes(key),
      )
    )
      throw new Error("Unknown synthetic session request");
    const next = offset < 18 ? `task24-page-${offset + 1}` : null;
    // Short pages still exercise the unchanged production eight-page budget.
    // Do not reduce quotas/page sizes/budgets or clear durable progress.
    return {
      kind: "synthetic",
      body: {
        object: "list",
        results: [
          {
            object: "reading_session",
            id: `task24-import-${offset}`,
            date: "2025-06-01T10:00:00Z",
            seconds_read: 60,
          },
        ],
        has_more: !!next,
        next_cursor: next,
      },
      ...(state.hold ? { delay: 1500 } : {}),
    };
  }
  if (path === "/public/v1/items")
    return {
      kind: "synthetic",
      body: {
        object: "list",
        results: [
          {
            object: "item",
            id: "task24-imported-item",
            title: "Synthetic imported metadata",
            tags: [],
          },
        ],
        has_more: false,
        next_cursor: null,
      },
    };
  if (path === "/public/v1/items/task24-imported-item/annotations")
    return {
      kind: "synthetic",
      body: { object: "list", results: [], has_more: false, next_cursor: null },
    };
  throw new Error("Unknown synthetic Matter request");
}
