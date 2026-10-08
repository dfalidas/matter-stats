export const CONTINUATION_TABLES = ["matter_sync_continuation"];
export const CONTINUATION_FUNCTION_SIGNATURES = [
  "cooldown_matter_account(text,uuid,bigint,timestamp with time zone)",
  "request_matter_history(text,uuid,bigint,text)",
  "begin_matter_history(text,uuid,bigint,integer,timestamp with time zone)",
  "turn_matter_continuation(text,uuid,bigint,text)",
  "complete_matter_history()",
];
