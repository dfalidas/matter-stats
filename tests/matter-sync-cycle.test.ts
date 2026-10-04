import assert from "node:assert/strict";
import test from "node:test";

import {
  completeMatterCycle,
  MATTER_SYNC_OVERLAP_DAYS,
  persistActiveMatterCycle,
  startOrResumeMatterCycle,
} from "../lib/matter-sync-cycle";
import type { MatterSyncStream } from "../lib/supabase-types";

function row(overrides: Partial<MatterSyncStream> = {}): MatterSyncStream {
  return {
    stream: "recent_sessions",
    endpoint: "/reading_sessions",
    filters: {},
    page_limit: 25,
    cursor: null,
    cycle_started_at: null,
    cycle_generation: 0,
    completed_watermark: null,
    retry_at: null,
    cycle_active: false,
    transition_status: "native",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("manual → scheduled → manual resumes one session contract across invocations", () => {
  const manual = startOrResumeMatterCycle({
    stream: "recent_sessions", stored: null, now: new Date("2026-12-31T23:59:00Z"), configuredLimit: 25,
    initialSince: "2026-01-01T00:00:00.000Z",
  });
  const persisted = row(persistActiveMatterCycle(manual, "opaque-page-2") as MatterSyncStream);
  const scheduled = startOrResumeMatterCycle({
    stream: "recent_sessions", stored: persisted, now: new Date("2027-01-01T00:01:00Z"), configuredLimit: 100,
    initialSince: "2027-01-01T00:00:00.000Z",
  });
  const again = startOrResumeMatterCycle({ stream: "recent_sessions", stored: persisted, now: new Date("2027-02-01"), configuredLimit: 5 });

  for (const resumed of [scheduled, again]) {
    assert.equal(resumed.cursor, "opaque-page-2");
    assert.equal(resumed.pageLimit, 25);
    assert.deepEqual(resumed.filters, { since: "2026-01-01T00:00:00.000Z" });
    assert.equal(resumed.cycleStartedAt, manual.cycleStartedAt);
    assert.equal(resumed.cycleGeneration, manual.cycleGeneration);
  }
});

test("session and library streams retain independent cursors and cooldowns", () => {
  const sessions = startOrResumeMatterCycle({ stream: "recent_sessions", stored: null, now: new Date("2026-06-01"), configuredLimit: 20 });
  const library = startOrResumeMatterCycle({ stream: "library_items", stored: null, now: new Date("2026-06-02"), configuredLimit: 40 });
  const sessionRow = row(persistActiveMatterCycle(sessions, "session-cursor", "2026-06-03T00:00:00Z") as MatterSyncStream);
  const libraryRow = row({ ...(persistActiveMatterCycle(library, "item-cursor") as MatterSyncStream), stream: "library_items" });

  assert.equal(sessionRow.cursor, "session-cursor");
  assert.equal(sessionRow.retry_at, "2026-06-03T00:00:00Z");
  assert.equal(libraryRow.cursor, "item-cursor");
  assert.equal(libraryRow.retry_at, null);
});

test("partial persistence and retry do not advance the completed watermark", () => {
  const active = startOrResumeMatterCycle({
    stream: "recent_sessions",
    stored: row({ completed_watermark: "2026-05-01T00:00:00.000Z" }),
    now: new Date("2026-05-10T12:00:00.000Z"), configuredLimit: 25,
  });
  const partial = persistActiveMatterCycle(active, "next", "2026-05-10T12:05:00.000Z");
  assert.equal(partial.completed_watermark, "2026-05-01T00:00:00.000Z");
  assert.equal(partial.cycle_active, true);
  assert.equal(partial.cursor, "next");
});

test("only exhausted cycles, including empty cycles, promote cycle start", () => {
  const active = startOrResumeMatterCycle({ stream: "recent_sessions", stored: null, now: new Date("2026-08-20T10:00:00Z"), configuredLimit: 25 });
  const completed = completeMatterCycle(active);
  assert.equal(completed.completed_watermark, "2026-08-20T10:00:00.000Z");
  assert.equal(completed.cycle_active, false);
  assert.equal(completed.cursor, null);
});

test("subsequent cycles use the seven-day application overlap without adding 1ms", () => {
  const next = startOrResumeMatterCycle({
    stream: "recent_sessions",
    stored: row({ completed_watermark: "2026-08-20T10:00:00.000Z", cycle_generation: 4 }),
    now: new Date("2026-08-21T10:00:00Z"), configuredLimit: 25,
  });
  assert.equal(MATTER_SYNC_OVERLAP_DAYS, 7);
  assert.equal(next.filters.since, "2026-08-13T10:00:00.000Z");
  assert.equal(next.cycleGeneration, 5);
});

test("an incompatible active endpoint is rejected rather than pairing its cursor with new filters", () => {
  assert.throws(() => startOrResumeMatterCycle({
    stream: "recent_sessions",
    stored: row({ endpoint: "/items", cycle_active: true, cycle_started_at: "2026-01-01T00:00:00Z", cursor: "unsafe" }),
    now: new Date(), configuredLimit: 25,
  }), /explicit recoverable restart/);
});

test("legacy recoverable restart preserves no unsupported completion claim", () => {
  const legacy = row({ transition_status: "legacy_recoverable_restart", completed_watermark: null });
  const restarted = startOrResumeMatterCycle({
    stream: "recent_sessions", stored: legacy, now: new Date("2026-09-01"), configuredLimit: 25,
    initialSince: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(restarted.completedWatermark, null);
  assert.equal(restarted.cursor, null);
  assert.deepEqual(restarted.filters, { since: "2026-01-01T00:00:00.000Z" });
});
