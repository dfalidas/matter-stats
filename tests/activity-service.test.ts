import assert from "node:assert/strict";
import test from "node:test";
import { getActivityMonth, isCalendarDate, isCalendarMonth, normalizeActivityPage } from "../lib/activity-service";

type Row = { id: string; started_at: string; duration_seconds: number };

class Query {
  private start = "";
  private end = "~";
  private window: [number, number] = [0, Number.MAX_SAFE_INTEGER];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  constructor(private readonly rows: Row[]) {}
  select() { return this; }
  gte(_column: string, value: string) { this.start = value; return this; }
  lt(_column: string, value: string) { this.end = value; return this; }
  order(column: string, options: { ascending?: boolean }) { this.orders.push({ column, ascending: options.ascending ?? true }); return this; }
  range(from: number, to: number) { this.window = [from, to]; return this; }
  then<TResult1 = { data: Row[]; error: null }>(onfulfilled?: (value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) {
    const rows = this.rows
      .filter((row) => row.started_at >= this.start && row.started_at < this.end)
      .sort((left, right) => {
        for (const order of this.orders) {
          const comparison = String(left[order.column as keyof Row]).localeCompare(String(right[order.column as keyof Row]));
          if (comparison) return order.ascending ? comparison : -comparison;
        }
        return 0;
      })
      .slice(this.window[0], this.window[1] + 1);
    return Promise.resolve({ data: rows, error: null }).then(onfulfilled);
  }
}

function client(rows: Row[]) {
  return { from: () => new Query(rows) } as never;
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
