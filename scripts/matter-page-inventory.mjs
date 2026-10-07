export const PAGE_TABLES = ["matter_page_receipts", "matter_dirty_rollups"];
export const PAGE_FUNCTION_SIGNATURES = [
  "validate_matter_page_rows(jsonb,text)",
  "commit_matter_page(text,uuid,bigint,uuid,uuid,jsonb,jsonb,boolean,text,text)",
  "pending_matter_rollups(text,uuid,bigint,integer)",
  "ack_matter_rollup(text,uuid,bigint,date,uuid,text,jsonb)",
];
