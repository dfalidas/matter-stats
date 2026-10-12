import assert from "node:assert/strict";
import test from "node:test";
import { getArticleDetail, getArticleList } from "../lib/articles-service";
import { getReadingMetrics, resolveMetricsDateRange } from "../lib/metrics-service";
import { getSourceRanking } from "../lib/sources-service";
import { getTagRanking } from "../lib/tags-service";
import { readCompleteMetadata, readIdBatches } from "../lib/complete-metadata-query";
import { cappedPostgrest } from "./fixtures/capped-postgrest";

const time = "2026-09-10T10:00:00Z";
const options = { preset: "month" as const, now: "2026-09-10T18:00:00Z", timezone: "UTC" };
const sharedTag = 'shared,(tag):"\\';

function dataset(count: number, fanout = 1205, tagCount = 1205) {
  const items = Array.from({ length: count }, (_, i) => ({
    id: `item-${String(i).padStart(6, "0")}`, title: `Title ${i}`, url: null,
    source: i % 7 === 0 ? null : i % 3 === 0 ? " Other " : "Source",
    author: i % 5 === 0 ? null : "Author", content_type: "article", status: "archive",
    word_count: i % 2 === 0 ? 1000 : null, estimated_reading_time_minutes: null, progress: null,
    created_at_matter: i % 4 === 0 ? null : i % 4 === 1 ? time : "2026-09-09T10:00:00Z",
    updated_at_matter: i % 3 === 0 ? null : time,
  }));
  // Give the hot item the exact same source as many other items.
  if (items.length) items[0].source = "Source";
  const tags = [{ id: sharedTag, name: "Shared" }, ...Array.from({ length: tagCount }, (_, i) => ({ id: `tag-${String(i).padStart(6, "0")}`, name: `Tag ${String(i).padStart(6, "0")}` }))];
  const links = items.flatMap((item, i) => [
    { item_id: item.id, tag_id: sharedTag },
    { item_id: item.id, tag_id: tags[1 + i % tagCount].id },
  ]);
  // One item has more relations than the largest response cap. Keep the actual
  // composite PK unique even when that item already has its ordinary tag.
  if (items.length) for (let i = 1; i < Math.min(fanout, tags.length - 1); i++) links.push({ item_id: items[0].id, tag_id: tags[i + 1].id });
  const annotations = items.map((item, i) => ({ id: `a-${String(i).padStart(6, "0")}`, item_id: item.id, text: null, note: null, created_at_matter: time as string | null }));
  if (items.length) for (let i = 0; i < fanout; i++) annotations.push({
    id: `hot-${String(i).padStart(6, "0")}`, item_id: items[0].id,
    text: null, note: null, created_at_matter: i % 3 === 0 ? null : time,
  });
  const sessions = items.map((item, i) => ({ id: `s-${String(i).padStart(6, "0")}`, item_id: item.id, started_at: time as string | null, ended_at: null, duration_seconds: 60, words_estimated: 999999,
    matter_items: i % 2 ? item : [item],
  }));
  // Source performance includes null dates, whereas date-bound rankings do not.
  if (items.length) for (let i = 0; i < 275; i++) sessions.push({ ...sessions[0], id: `hot-s-${i}`, started_at: i % 2 ? time : null });
  const unlinked = { id: "unlinked", item_id: null, started_at: time, ended_at: null, duration_seconds: 180, words_estimated: null, matter_items: null };
  return { items, tags, links, annotations, sessions: [...sessions, unlinked] };
}

function fixture(data: ReturnType<typeof dataset>, cap: number) {
  return cappedPostgrest({ matter_items: data.items, matter_tags: data.tags, item_tags: data.links, annotations: data.annotations, reading_sessions: data.sessions }, { cap, maxUrlBytes: 8000 });
}

// Expected ordering is constructed directly from original entities, independent
// of the HTTP evaluator and production retrieval/batching code.
function libraryOrder(items: ReturnType<typeof dataset>["items"]) {
  return [...items].sort((a, b) => {
    for (const key of ["created_at_matter", "updated_at_matter"] as const) {
      if (a[key] === b[key]) continue;
      if (a[key] === null) return 1;
      if (b[key] === null) return -1;
      return a[key]! > b[key]! ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

for (const cap of [100, 300, 1000]) {
  test(`Library facets, global selected-tag pages, hot-item metadata and source performance under cap ${cap}`, async () => {
    const data = dataset(1205);
    const { client, requests } = fixture(data, cap);
    const expectedSources = new Map<string, number>();
    for (const item of data.items) if (item.source?.trim()) expectedSources.set(item.source.trim(), (expectedSources.get(item.source.trim()) ?? 0) + 1);
    const expected = libraryOrder(data.items);
    for (const page of [1, 7, 13]) {
      const result = await getArticleList(client, { tag: sharedTag, page });
      assert.equal(result.total, data.items.length);
      assert.deepEqual(result.articles.map((a) => a.id), expected.slice((page - 1) * 100, page * 100).map((a) => a.id));
      assert.deepEqual(new Map(result.sources.map((s) => [s.value, s.count])), expectedSources);
      assert.deepEqual(result.tags, [...data.tags].sort((a, b) => a.name < b.name ? -1 : 1).map((t) => ({ value: t.id, label: t.name })));
      for (const article of result.articles) {
        assert.equal(article.highlights, data.annotations.filter((a) => a.item_id === article.id).length);
        assert.deepEqual(article.tags.map((t) => t.id).sort(), data.links.filter((l) => l.item_id === article.id).map((l) => l.tag_id).sort());
        assert.ok(!("item_tags" in article), "public contract does not expose query embed");
      }
    }
    const detail = (await getArticleDetail(client, data.items[0].id))!;
    const expectedAnnotations = data.annotations.filter((a) => a.item_id === detail.id).sort((a, b) => {
      if (a.created_at_matter !== b.created_at_matter) return a.created_at_matter === null ? 1 : -1;
      return a.id < b.id ? -1 : 1;
    });
    assert.deepEqual(detail.annotations, expectedAnnotations.map(({ id, text, note, created_at_matter }) => ({ id, text, note, created_at_matter })));
    assert.equal(detail.tags.length, data.links.filter((l) => l.item_id === detail.id).length);
    assert.equal(detail.sessions.length, 25);
    assert.equal(detail.relatedArticles.length, 5);
    const sourceIds = new Set(data.items.filter((i) => i.source === "Source").map((i) => i.id));
    const sourceSessions = data.sessions.filter((s) => s.item_id !== null && sourceIds.has(s.item_id));
    const totalTime = sourceSessions.reduce((sum, s) => sum + (s.duration_seconds ?? 0), 0);
    const articleTime = sourceSessions.filter((s) => s.item_id === detail.id).reduce((sum, s) => sum + (s.duration_seconds ?? 0), 0);
    const average = Math.round(totalTime / sourceIds.size);
    assert.deepEqual(detail.sourcePerformance, { source: "Source", sourceArticleCount: sourceIds.size, sourceAverageTimeSeconds: average, articleTimeSeconds: articleTime, percentVsAverage: (articleTime - average) / average * 100 });
    assert.ok(requests.some((r) => r.table === "annotations" && Number(r.url.searchParams.get("offset")) > 1000));
    assert.ok(requests.some((r) => r.table === "item_tags" && Number(r.url.searchParams.get("offset")) > 1000));
    assert.ok(requests.every((r) => !r.url.searchParams.has("id") || !r.url.searchParams.get("id")!.startsWith("in.")), "tag pages never concatenate ID batches");
  });
}

test("more than 10,000 metadata/relation rows reach facets, Metrics and source/tag annotation inputs", async () => {
  const data = dataset(10037, 1205, 10037);
  const { client, requests } = fixture(data, 100);
  const list = await getArticleList(client, { tag: sharedTag, page: 101 });
  assert.equal(list.total, 10037);
  assert.equal(list.tags.length, data.tags.length);
  assert.deepEqual(list.articles.map((a) => a.id), libraryOrder(data.items).slice(10000).map((a) => a.id));
  assert.equal(list.sources.reduce((sum, facet) => sum + facet.count!, 0), data.items.filter((i) => i.source?.trim()).length);
  const metrics = await getReadingMetrics(client, { ...options, topLimit: 20000 });
  const datedSessions = data.sessions.filter((s) => s.started_at !== null);
  assert.equal(metrics.totals.totalReadingTimeSeconds, datedSessions.reduce((sum, s) => sum + s.duration_seconds, 0));
  assert.equal(metrics.totals.sessionsCount, datedSessions.length);
  assert.equal(metrics.totals.articlesRead, data.items.length);
  const sources = await getSourceRanking(client, options);
  const tags = await getTagRanking(client, options);
  const expectedAnnotations = data.annotations.filter((a) => a.created_at_matter !== null);
  assert.equal(tags.totals.highlights, expectedAnnotations.length);
  assert.equal(tags.totals.articlesRead, data.items.length);
  assert.equal(tags.totals.readingTimeSeconds, datedSessions.filter((s) => s.item_id !== null).reduce((sum, s) => sum + s.duration_seconds, 0));
  const relationsByTag = new Map<string, Set<string>>();
  for (const link of data.links) {
    if (!relationsByTag.has(link.tag_id)) relationsByTag.set(link.tag_id, new Set());
    relationsByTag.get(link.tag_id)!.add(link.item_id);
  }
  const timeByItem = new Map<string, number>();
  for (const session of datedSessions) if (session.item_id !== null) timeByItem.set(session.item_id, (timeByItem.get(session.item_id) ?? 0) + session.duration_seconds);
  const highlightsByItem = new Map<string, number>();
  for (const a of expectedAnnotations) highlightsByItem.set(a.item_id, (highlightsByItem.get(a.item_id) ?? 0) + 1);
  const rankedTags = new Map(tags.tags.map((t) => [t.tagId, t]));
  const metricTags = new Map(metrics.topTags.map((t) => [t.name, t]));
  for (const tag of data.tags) {
    const itemIds = relationsByTag.get(tag.id)!;
    const expectedTime = [...itemIds].reduce((sum, id) => sum + (timeByItem.get(id) ?? 0), 0);
    const ranking = rankedTags.get(tag.id);
    assert.equal(ranking?.readingTimeSeconds, expectedTime);
    assert.equal(ranking?.articlesRead, itemIds.size);
    assert.equal(ranking?.highlights, [...itemIds].reduce((sum, id) => sum + (highlightsByItem.get(id) ?? 0), 0));
    assert.equal(metricTags.get(tag.name)?.readingTimeSeconds, expectedTime);
  }
  for (const source of sources.sources) {
    const ids = new Set(data.items.filter((i) => i.source?.trim() === source.source).map((i) => i.id));
    assert.equal(source.highlights, expectedAnnotations.filter((a) => ids.has(a.item_id)).length);
    assert.equal(source.readingTimeSeconds, datedSessions.filter((s) => s.item_id !== null && ids.has(s.item_id)).reduce((sum, s) => sum + s.duration_seconds, 0));
  }
  const sourcedIds = new Set(data.items.filter((i) => i.source?.trim()).map((i) => i.id));
  assert.equal(sources.totals.highlights, expectedAnnotations.filter((a) => sourcedIds.has(a.item_id)).length);
  const filters = new Set(requests.filter((r) => r.table === "item_tags").map((r) => r.url.searchParams.get("item_id")));
  assert.ok(filters.size > 100, "multiple complete ID batches");
});

test("Library tag join retains all other filters, empty results and globally scoped facets", async () => {
  const data = dataset(205, 0, 5);
  data.items[1].title = 'literal "(title):\\';
  data.items[2].status = "reading";
  data.items[4].content_type = "pdf";
  data.items[8].word_count = 1700;
  data.items[16].word_count = 4100;
  const { client } = fixture(data, 100);
  const filtered = await getArticleList(client, { tag: sharedTag, source: "Source", status: "archive", author: "Author", contentType: "article", size: "short" });
  const expected = data.items.filter((i) => i.source === "Source" && i.author === "Author" && i.status === "archive" && i.content_type === "article" && i.word_count !== null && i.word_count < 1500);
  assert.equal(filtered.total, expected.length);
  assert.deepEqual(filtered.articles.map((i) => i.id), libraryOrder(expected).map((i) => i.id));
  assert.equal(filtered.tags.length, data.tags.length);
  for (const size of ["medium", "long"]) {
    const result = await getArticleList(client, { tag: sharedTag, size });
    const matches = data.items.filter((i) => i.word_count !== null && (size === "medium" ? i.word_count >= 1500 && i.word_count < 4000 : i.word_count >= 4000));
    assert.deepEqual(result.articles.map((i) => i.id), libraryOrder(matches).map((i) => i.id));
  }
  assert.equal((await getArticleList(client, { tag: "absent" })).total, 0);
  assert.equal((await getArticleList(client, { tag: sharedTag, query: 'literal "(title):\\' })).articles[0].id, data.items[1].id);
  const empty = await getArticleList(fixture(dataset(0), 100).client);
  assert.deepEqual(empty.articles, []);
  assert.deepEqual(empty.sources, []);
});

test("selected-tag period keeps half-open date boundaries and global facets", async () => {
  const data = dataset(5, 0, 3);
  const range = resolveMetricsDateRange({ preset: "today" });
  data.items[0].created_at_matter = new Date(range.start!.getTime() - 1).toISOString();
  data.items[1].created_at_matter = range.start!.toISOString();
  data.items[2].created_at_matter = new Date(range.end.getTime() - 1).toISOString();
  data.items[3].created_at_matter = range.end.toISOString();
  data.items[4].created_at_matter = null;
  const result = await getArticleList(fixture(data, 100).client, { period: "today", tag: sharedTag });
  assert.equal(result.total, 2);
  assert.deepEqual(result.articles.map((i) => i.id), [data.items[2].id, data.items[1].id]);
  assert.equal(result.tags.length, data.tags.length);
  assert.equal(result.sources.reduce((sum, s) => sum + s.count!, 0), data.items.filter((i) => i.source !== null).length);
});

test("reserved/long item IDs use escaped byte-bounded filters, with complete hot-item pages in every batch", async () => {
  const data = dataset(15, 205, 205);
  const replacements = data.items.map((item, i) => ({ old: item.id, value: `${['comma,', '"quote', 'back\\slash', 'paren()', 'colon:', 'dot.', '雪'][i % 7]}${"x".repeat(700)}-${i}` }));
  for (const { old, value } of replacements) {
    data.items.find((i) => i.id === old)!.id = value;
    for (const row of [...data.links, ...data.annotations, ...data.sessions]) if (row.item_id === old) row.item_id = value;
  }
  const { client, requests } = fixture(data, 100);
  const list = await getArticleList(client, { tag: sharedTag });
  assert.equal(list.total, 15);
  const hot = list.articles.find((a) => a.id === data.items[0].id)!;
  assert.equal(hot.highlights, 206);
  assert.equal(hot.tags.length, 206);
  const ranking = await getTagRanking(client, options);
  assert.equal(ranking.totals.articlesRead, 15);
  assert.equal(ranking.tags.find((t) => t.tagId === sharedTag)!.highlights, data.annotations.filter((a) => a.created_at_matter !== null).length);
  const detail = (await getArticleDetail(client, data.items[0].id))!;
  assert.equal(detail.annotations.length, 206);
  const filters = new Set(requests.filter((r) => r.table === "item_tags").map((r) => r.url.searchParams.get("item_id")));
  assert.ok(filters.size > 2, "encoded bytes split fewer than 100 IDs");
  assert.ok(requests.some((r) => r.url.searchParams.get("item_id")?.includes('\\"')));
  assert.ok(requests.some((r) => r.url.searchParams.get("item_id")?.includes('\\\\')));
});

for (const count of [0, 100, 300, 500, 501, 1000]) {
  test(`metadata empty/exact/final pages: ${count}`, async () => {
    const rows = Array.from({ length: count }, (_, i) => ({ id: `id-${String(i).padStart(5, "0")}`, source: null }));
    const { client, requests } = cappedPostgrest({ matter_items: rows }, { cap: 100 });
    const result = await readCompleteMetadata(() => client.from("matter_items").select("id,source").order("id"));
    assert.deepEqual(result, rows);
    assert.deepEqual(requests.map((r) => Number(r.url.searchParams.get("offset"))), Array.from({ length: Math.ceil(count / 100) + 1 }, (_, i) => Math.min(i * 100, count)));
  });
}

test("ID batching deduplicates inputs, accepts empty inputs and rejects duplicates across later batches", async () => {
  let calls = 0;
  assert.deepEqual(await readIdBatches([], async () => { calls++; return []; }), []);
  assert.equal(calls, 0);
  const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  const result = await readIdBatches([...ids, ...ids], async (batch) => { calls++; return batch.map((id) => ({ id })); });
  assert.deepEqual(result.map((r) => r.id), ids);
  assert.equal(calls, 3);
  await assert.rejects(readIdBatches(ids, async () => [{ id: "repeated" }]), /Duplicate.*batch/);
  await assert.rejects(readIdBatches(["x".repeat(6001)], async () => []), /encoded filter budget/);
});

test("HTTP fixture treats standalone scalar quote/backslash values literally and logical/in delimiters separately", async () => {
  const rows = [{ id: '"literal\\,():.', source: '"Source"' }];
  const { client } = cappedPostgrest({ matter_items: rows });
  const result = await client.from("matter_items").select("id,source").eq("id", rows[0].id).eq("source", rows[0].source);
  assert.deepEqual(result.data, rows);
  const noMatch = await client.from("matter_items").select("id").eq("source", "Source");
  assert.deepEqual(noMatch.data, []);
});

for (const fault of ["null-response", "object-response", "null-row", "missing-key", "duplicate", "repeat-page", "late-error"] as const) {
  test(`Library propagates later facet ${fault}`, async () => {
    const data = dataset(205, 0, 5);
    const { client } = cappedPostgrest({ matter_items: data.items, matter_tags: data.tags }, { cap: 100, respond: (request, result) => {
      if (request.table !== "matter_items" || request.url.searchParams.get("select") !== "id,source" || request.url.searchParams.get("offset") !== "100") return;
      if (fault === "late-error") return Response.json({ message: "later facet failure", code: "XX000" }, { status: 500 });
      if (fault === "null-response") return Response.json(null);
      if (fault === "object-response") return Response.json({ rows: result });
      if (fault === "null-row") return Response.json([null]);
      if (fault === "missing-key") return Response.json([{ source: "Source" }]);
      if (fault === "duplicate") return Response.json([result[0], result[0]]);
      return Response.json(data.items.filter((i) => i.source !== null).sort((a, b) => (a.source! < b.source! ? -1 : a.source! > b.source! ? 1 : a.id < b.id ? -1 : 1)).slice(0, 100));
    } });
    await assert.rejects(getArticleList(client), (e: unknown) => /complete-metadata|later facet failure/.test((e as Error).message));
  });
}

test("later relation/annotation batch failures reject Metrics and source/tag rankings", async () => {
  const data = dataset(205, 205, 205);
  for (const table of ["item_tags", "annotations"]) {
    const services = table === "item_tags"
      ? [(c: Parameters<typeof getArticleList>[0]) => getReadingMetrics(c, options), (c: Parameters<typeof getArticleList>[0]) => getTagRanking(c, options)]
      : [(c: Parameters<typeof getArticleList>[0]) => getTagRanking(c, options), (c: Parameters<typeof getArticleList>[0]) => getSourceRanking(c, options)];
    for (const service of services) {
      const seen = new Set<string>();
      const { client } = cappedPostgrest({ matter_items: data.items, matter_tags: data.tags, item_tags: data.links, annotations: data.annotations, reading_sessions: data.sessions }, { cap: 100, respond: (r) => {
        if (r.table !== table) return;
        seen.add(r.url.searchParams.get("item_id")!);
        if (seen.size === 2) return Response.json({ message: "later batch failure", code: "XX000" }, { status: 500 });
      } });
      await assert.rejects(service(client), (e: unknown) => (e as Error).message === "later batch failure");
    }
  }
});

test("article annotations and source performance reject later pages/batches", async () => {
  const data = dataset(305, 205, 205);
  for (const failure of ["annotation-page", "source-item-page", "source-session-batch"]) {
    const sessionFilters = new Set<string>();
    const { client } = cappedPostgrest({ matter_items: data.items, matter_tags: data.tags, item_tags: data.links, annotations: data.annotations, reading_sessions: data.sessions }, { cap: 100, respond: (r) => {
      if (failure === "annotation-page" && r.table === "annotations" && r.url.searchParams.get("offset") === "100"
        || failure === "source-item-page" && r.table === "matter_items" && r.url.searchParams.get("select") === "id" && r.url.searchParams.get("offset") === "100") return Response.json({ message: failure, code: "XX000" }, { status: 500 });
      if (failure === "source-session-batch" && r.table === "reading_sessions" && r.url.searchParams.get("limit") !== "25") {
        sessionFilters.add(r.url.searchParams.get("item_id")!);
        if (sessionFilters.size === 2) return Response.json({ message: failure, code: "XX000" }, { status: 500 });
      }
    } });
    await assert.rejects(getArticleDetail(client, data.items[0].id), (e: unknown) => (e as Error).message === failure);
  }
});

test("Library rejects later ID batches for tags and highlights instead of returning partial metadata", async () => {
  const data = dataset(100, 0, 5);
  for (const item of data.items) {
    const old = item.id;
    item.id = `${old}-${"x".repeat(700)}`;
    for (const row of [...data.links, ...data.annotations]) if (row.item_id === old) row.item_id = item.id;
  }
  for (const table of ["item_tags", "annotations"]) {
    const seen = new Set<string>();
    const { client } = cappedPostgrest({ matter_items: data.items, matter_tags: data.tags, item_tags: data.links, annotations: data.annotations }, { cap: 100, respond: (r) => {
      if (r.table !== table) return;
      seen.add(r.url.searchParams.get("item_id")!);
      if (seen.size === 2) return Response.json({ message: "Library later batch", code: "XX000" }, { status: 500 });
    } });
    await assert.rejects(getArticleList(client), (e: unknown) => (e as Error).message === "Library later batch");
  }
});

test("relation traversal validates the composite key and rejects repeated or missing-key later pages", async () => {
  const data = dataset(1, 205, 205);
  for (const fault of ["repeat", "missing-tag-key", "duplicate-pair"]) {
    const { client } = cappedPostgrest({ matter_items: data.items, item_tags: data.links, matter_tags: data.tags }, { cap: 100, respond: (r, result) => {
      if (r.table !== "item_tags" || r.url.searchParams.get("offset") !== "100") return;
      if (fault === "missing-tag-key") return Response.json([{ item_id: data.items[0].id, matter_tags: null }]);
      if (fault === "duplicate-pair") return Response.json([result[0], result[0]]);
      return Response.json(data.links.slice(0, 100));
    } });
    await assert.rejects(getArticleList(client), /complete-metadata/);
  }
});

test("nullable metadata and object/array/null tag embeds retain their existing interpretation", async () => {
  const data = dataset(1, 0, 3);
  data.items[0].source = null;
  const links = [
    { item_id: data.items[0].id, tag_id: "a", matter_tags: { id: "a", name: " Object " } },
    { item_id: data.items[0].id, tag_id: "b", matter_tags: [{ id: "b", name: "Array" }] },
    { item_id: data.items[0].id, tag_id: "c", matter_tags: null },
  ];
  const { client } = cappedPostgrest({ matter_items: data.items, reading_sessions: data.sessions, item_tags: links }, { cap: 1 });
  const list = await getArticleList(client);
  assert.equal(list.articles[0].source, null);
  assert.equal(list.articles[0].word_count, 1000);
  assert.equal(list.articles[0].progress, null);
  assert.deepEqual(list.sources, []);
  assert.deepEqual(list.articles[0].tags, [{ id: "a", name: " Object " }, { id: "b", name: "Array" }]);
  const detail = (await getArticleDetail(client, data.items[0].id))!;
  assert.equal(detail.sourcePerformance, null);
  const ranking = await getTagRanking(client, options);
  assert.deepEqual(ranking.tags.map((t) => t.tag).sort(), ["Array", "Object"]);
});

test("source performance denominator includes unread source items and sessions with null timestamps", async () => {
  const data = dataset(3, 0, 3);
  for (const item of data.items) item.source = "Source";
  const sessions = [
    { id: "s1", item_id: data.items[0].id, started_at: null, duration_seconds: 120 },
    { id: "s2", item_id: data.items[1].id, started_at: time, duration_seconds: 60 },
    { id: "unlinked", item_id: null, started_at: time, duration_seconds: 900 },
  ];
  const { client } = cappedPostgrest({ matter_items: data.items, reading_sessions: sessions }, { cap: 1 });
  const detail = (await getArticleDetail(client, data.items[0].id))!;
  assert.deepEqual(detail.sourcePerformance, { source: "Source", sourceArticleCount: 3, sourceAverageTimeSeconds: 60, articleTimeSeconds: 120, percentVsAverage: 100 });
});

test("annotation ordering preserves microseconds, tied IDs and the null timestamp tail", async () => {
  const data = dataset(1, 0, 3);
  data.items[0].source = null;
  const annotations = [
    { id: "z", item_id: data.items[0].id, created_at_matter: "2026-09-10T10:00:00.000002Z", text: null, note: null },
    { id: "b", item_id: data.items[0].id, created_at_matter: "2026-09-10T10:00:00.000001Z", text: null, note: null },
    { id: "a", item_id: data.items[0].id, created_at_matter: "2026-09-10T10:00:00.000001Z", text: null, note: null },
    { id: "null-b", item_id: data.items[0].id, created_at_matter: null, text: null, note: null },
    { id: "null-a", item_id: data.items[0].id, created_at_matter: null, text: null, note: null },
  ];
  const { client } = cappedPostgrest({ matter_items: data.items, annotations }, { cap: 1 });
  const detail = (await getArticleDetail(client, data.items[0].id))!;
  assert.deepEqual(detail.annotations.map((a) => a.id), ["a", "b", "z", "null-a", "null-b"]);
});

test("live offset consistency: unseen updates are observed, deletions can shift unseen rows, and inserts can fail closed", async () => {
  const initial = Array.from({ length: 250 }, (_, i) => ({ id: `id-${String(i).padStart(4, "0")}`, source: "before" }));
  for (const mutation of ["update", "delete", "insert"] as const) {
    const rows = initial.map((r) => ({ ...r }));
    const { client } = cappedPostgrest({ matter_items: rows }, { cap: 100, before: (r) => {
      if (r.number !== 2) return;
      if (mutation === "update") rows[150].source = "after";
      if (mutation === "delete") rows.splice(0, 1);
      if (mutation === "insert") rows.push({ id: "id-0000-new", source: "new" });
    } });
    const read = () => readCompleteMetadata<{ id: string; source: string }>(() => client.from("matter_items").select("id,source").order("id"));
    if (mutation === "insert") await assert.rejects(read(), /Duplicate or non-advancing/);
    else {
      const result = await read();
      assert.equal(result.length, mutation === "delete" ? 249 : 250);
      if (mutation === "update") assert.equal(result.find((r) => r.id === "id-0150")!.source, "after");
      if (mutation === "delete") { assert.ok(result.some((r) => r.id === "id-0000")); assert.ok(!result.some((r) => r.id === "id-0100")); }
    }
  }
});
