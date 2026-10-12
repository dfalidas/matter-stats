import { cappedPostgrest } from "./fixtures/capped-postgrest";
import assert from "node:assert/strict";
import test from "node:test";
import { getActivityMonth, isCalendarDate, isCalendarMonth, normalizeActivityPage } from "../lib/activity-service";

type Row = { id: string; started_at: string; duration_seconds: number };

function client(rows: Row[]) {
  return cappedPostgrest({ reading_sessions: rows }).client;
}

test("validates real calendar values and positive integer pages", () => {
  assert.equal(isCalendarMonth("2026-13"), false);
  assert.equal(isCalendarMonth("2026-02"), true);
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.equal(normalizeActivityPage("1.5"), 1);
  assert.equal(normalizeActivityPage("3"), 3);
});

test("uses one Athens today reference, includes local midnight, and excludes adjacent month", async () => {
  const result = await getActivityMonth(client([
    { id: "before", started_at: "2026-08-31T20:59:59.000Z", duration_seconds: 60 },
    { id: "midnight", started_at: "2026-08-31T21:00:00.000Z", duration_seconds: 120 },
  ]), "2026-09", null, 1, new Date("2026-09-15T12:00:00Z"));
  assert.equal(result.today, "2026-09-15");
  assert.equal(result.selectedDay, "2026-09-15");
  assert.deepEqual(result.days.map((day) => day.date), ["2026-09-01"]);
});

test("resets an out-of-month day and returns complete totals across database pages", async () => {
  const timestamp = "2026-09-10T10:00:00.000Z";
  const rows = Array.from({ length: 1005 }, (_, index) => ({ id: String(index).padStart(4, "0"), started_at: timestamp, duration_seconds: 60 }));
  const result = await getActivityMonth(client(rows), "2026-09", "2026-08-31", 99, new Date("2026-10-01T00:00:00Z"));
  assert.equal(result.selectedDay, "2026-09-01");
  assert.equal(result.dayTotal.sessions, 0);

  const selected = await getActivityMonth(client(rows), "2026-09", "2026-09-10", 99, new Date("2026-10-01T00:00:00Z"));
  assert.equal(selected.dayTotal.sessions, 1005);
  assert.equal(selected.dayTotal.seconds, 60300);
  assert.equal(selected.dayTotal.estimatedWords, 226125);
  assert.equal(selected.totalPages, 51);
  assert.equal(selected.page, 51);
  assert.equal(selected.sessions.length, 5);
});

test("Athens month boundaries follow DST offsets", async () => {
  const result = await getActivityMonth(client([
    { id: "included", started_at: "2026-03-31T20:59:59.000Z", duration_seconds: 60 },
    { id: "excluded", started_at: "2026-03-31T21:00:00.000Z", duration_seconds: 60 },
  ]), "2026-03", "2026-03-31", 1, new Date("2026-04-02T00:00:00Z"));
  assert.equal(result.dayTotal.sessions, 1);
});

test("sums one-second estimates before pagination for calendar and selected-day totals", async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({ id: `tiny-${String(index).padStart(2, "0")}`, started_at: "2026-09-10T10:00:00.000Z", duration_seconds: 1 }));
  const result = await getActivityMonth(client(rows), "2026-09", "2026-09-10", 2, new Date("2026-10-01T00:00:00Z"));
  assert.equal(result.days[0]?.estimatedWords, 84);
  assert.equal(result.dayTotal.estimatedWords, 84);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0]?.estimatedWords, 4);
});
