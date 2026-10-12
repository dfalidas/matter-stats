// Only runner-owned local stacks and synthetic legacy fixtures may reset these
// new singleton rows. Production never clears quotas, chains or preparation.
import assert from "node:assert/strict";
const literal=(value)=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
export async function requestFixture(sql) {
 assert.equal(process.env.DISPOSABLE_DB_ACK,"yes");
 assert.match(process.env.STABILIZATION_TEST_SQL_PROJECT,/^matter-stats-(fresh|upgrade)-/);
 const before=JSON.parse(await sql("select jsonb_build_object('quota',(select to_jsonb(q) from public.matter_quota q),'work',(select jsonb_agg(to_jsonb(w) order by slot) from public.matter_request_work w))::text;"));
 const clearQuota=()=>sql("update public.matter_quota set read_starts='{}',burst_starts='{}',markdown_starts='{}',not_before=null,feedback_until=null,feedback_remaining=null where account_scope='matter';");
 const clearWork=()=>sql("update public.matter_request_work set requests='{}',contract=null,cursor_hashes='{}',cursor_generation=null where slot in ('bootstrap','recent_sessions','library_items');");
 return {clearQuota,clearWork,reset:async()=>{await clearQuota();await clearWork();},restore:async()=>{
  await sql(`update public.matter_quota q set read_starts=r.read_starts,burst_starts=r.burst_starts,markdown_starts=r.markdown_starts,sequence=r.sequence,not_before=r.not_before,feedback_until=r.feedback_until,feedback_remaining=r.feedback_remaining from jsonb_populate_record(null::public.matter_quota,${literal(before.quota)}) r where q.account_scope=r.account_scope;
   update public.matter_request_work w set contract=r.contract,requests=r.requests,cursor_generation=r.cursor_generation,cursor_hashes=r.cursor_hashes from jsonb_populate_recordset(null::public.matter_request_work,${literal(before.work)}) r where w.slot=r.slot;`);
  const after=JSON.parse(await sql("select jsonb_build_object('quota',(select to_jsonb(q) from public.matter_quota q),'work',(select jsonb_agg(to_jsonb(w) order by slot) from public.matter_request_work w))::text;"));assert.deepEqual(after,before);
 }};
}
