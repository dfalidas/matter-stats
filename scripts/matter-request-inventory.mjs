export const REQUEST_TABLES = ["matter_quota", "matter_request_work"];
export const REQUEST_FUNCTION_SIGNATURES = [
 "evaluate_matter_quota(jsonb,timestamp with time zone,boolean)",
 "prepare_matter_request_work(text,uuid,bigint,jsonb)",
 "admit_matter_request(text,text,boolean,boolean,jsonb)",
 "feedback_matter_request(bigint,integer,integer,timestamp with time zone,timestamp with time zone)",
 "finish_matter_request(text,text,bigint,jsonb,jsonb)",
 "track_matter_page_cursors()",
];
