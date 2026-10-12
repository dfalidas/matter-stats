import type { MatterListResponse } from "./matter-api";
import type { TablesInsert } from "./supabase-types";
import type { NormalizableMatterItem } from "./matter-normalizers";

export const MATTER_PAGE_MAX_BYTES = 4 * 1024 * 1024;
export const MATTER_ENRICHMENT_MAX_ROWS = 10000;
export type MatterPagePlan = {
  placeholders: TablesInsert<"matter_items">[];
  items: TablesInsert<"matter_items">[];
  sessions: TablesInsert<"reading_sessions">[];
  tags: TablesInsert<"matter_tags">[];
  itemTagIds: string[];
  itemTags: TablesInsert<"item_tags">[];
  annotations: TablesInsert<"annotations">[];
};

export class MatterPageValidationError extends Error {
  constructor(readonly reason: string) {
    super("Matter page rejected before persistence.");
    this.name = "MatterPageValidationError";
  }
}
export function emptyMatterPagePlan(): MatterPagePlan {
  return { placeholders: [], items: [], sessions: [], tags: [], itemTagIds: [], itemTags: [], annotations: [] };
}
// Share the ingestion checks with the HTTP preparation cache. A valid list
// envelope alone does not make an item safe to reuse on future invocations.
export function validateMatterItem(value: unknown): asserts value is NormalizableMatterItem {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof (value as { id?: unknown }).id !== "string" || !(value as { id: string }).id.trim()) {
    throw new MatterPageValidationError("invalid_item_id");
  }
  const tags = (value as { tags?: unknown }).tags;
  if (tags !== undefined && !Array.isArray(tags)) throw new MatterPageValidationError("invalid_tags");
  for (const tag of tags ?? []) {
    if (!tag || typeof tag.id !== "string" || !tag.id.trim()) throw new MatterPageValidationError("invalid_tag_id");
  }
}
export function validateMatterPage<T>(page: MatterListResponse<T>, limit: number, cursor: string | null): void {
  if (!page || page.object !== "list" || !Array.isArray(page.results)
      || typeof page.has_more !== "boolean" || !(page.next_cursor === null || typeof page.next_cursor === "string")) {
    throw new MatterPageValidationError("invalid_envelope");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || page.results.length > limit
      || Buffer.byteLength(JSON.stringify(page), "utf8") > MATTER_PAGE_MAX_BYTES) {
    throw new MatterPageValidationError("page_bound_exceeded");
  }
  if (page.has_more ? (!page.next_cursor?.trim() || page.next_cursor === cursor || page.next_cursor.length > 4096) : page.next_cursor !== null) {
    throw new MatterPageValidationError("invalid_continuation");
  }
}
export function validateMatterPagePlan(plan: MatterPagePlan): void {
  for (const [key, rows] of Object.entries(plan)) {
    const bound = ["tags", "itemTags", "annotations"].includes(key) ? MATTER_ENRICHMENT_MAX_ROWS : 100;
    if (rows.length > bound) throw new MatterPageValidationError("mutation_count_exceeded");
  }
  if (Buffer.byteLength(JSON.stringify(plan), "utf8") > MATTER_PAGE_MAX_BYTES) {
    throw new MatterPageValidationError("mutation_bytes_exceeded");
  }
}
