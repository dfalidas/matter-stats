import assert from 'node:assert/strict';
import { INVENTORIED_TABLES } from './stabilization-db-runner.mjs';

// All columns, every row, deterministic order. Only hashes/counts leave SQL;
// neither source data nor dumps are evidence artifacts.
export const restoreSnapshotSql = INVENTORIED_TABLES.map(table =>
  `select jsonb_build_object('table','${table}','count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')))::text from public.${table} r;`
).join('\n');

export const restoreSeedSql = String.raw`
insert into public.matter_items(id,title) values('restore-item','Synthetic restore');
insert into public.reading_sessions(id,item_id,started_at,ended_at,duration_seconds,words_estimated,source_device)
 values('restore-session','restore-item','2026-05-19T10:00:00Z','2026-05-19T10:12:34Z',754,2830,'synthetic');
insert into public.daily_stats(date,reading_time_seconds,words_read,sessions_count) values('2026-05-19',754,2830,1);
insert into public.sync_state(id,item_cursor,recent_activity_checkpoint) values('matter','synthetic-restore','2026-05-19T10:12:34Z');
-- Exercise the existing generation engine, bounded to a tiny synthetic input.
DO $fixture$
declare c public.reading_generation_control; g public.reading_generations;
  candidate uuid := '00000000-0000-4000-8000-000000000023';
  owner_id uuid := '00000000-0000-4000-8000-000000000123';
begin
 select * into strict c from public.reading_generation_control where singleton;
 perform public.repair_prepare(candidate,owner_id,c.active,c.epoch,'Europe/Athens');
 for i in 1..30 loop
   perform public.repair_batch(candidate,owner_id,1,100,250);
   select * into strict g from public.reading_generations where id=candidate;
   exit when g.state='catchup';
 end loop;
 if g.state<>'catchup' then raise exception 'restore fixture capture not complete'; end if;
 perform public.repair_reconcile(candidate,owner_id,1);
 for i in 1..30 loop
   perform public.repair_batch(candidate,owner_id,1,100,250);
   select * into strict g from public.reading_generations where id=candidate;
   exit when g.state='ready';
 end loop;
 if g.state<>'ready' then raise exception 'restore fixture reconciliation not complete'; end if;
 select * into strict c from public.reading_generation_control where singleton;
 perform public.repair_transition(candidate,owner_id,1,c.active,c.epoch,false);
end; $fixture$;
update public.matter_sync_leases set generation=generation+23,owner='00000000-0000-4000-8000-000000000523',expires_at='2099-01-01T00:00:00Z' where account_scope='matter';
update public.matter_sync_streams set cycle_active=true,cursor='synthetic-next',cycle_started_at='2026-10-01T00:00:00Z',
 cycle_generation=cycle_generation+23,page_limit=17,completed_watermark='2026-09-01T00:00:00Z',retry_at='2099-01-01T00:00:00Z'
 where stream='recent_sessions';
update public.matter_sync_continuation set history_status='pending',requested_at='2026-10-01T00:00:00Z' where account_scope='matter';
update public.matter_quota set sequence=sequence+23,not_before='2099-01-01T00:00:00Z',read_starts=array['2026-10-01T00:00:00Z'::timestamptz],burst_starts=array['2026-10-01T00:00:00Z'::timestamptz],feedback_until='2099-01-01T00:00:00Z',feedback_remaining=0 where account_scope='matter';
update public.matter_request_work set requests='{"synthetic":{"attempts":3,"pending":true,"next_at":"2099-01-01T00:00:00Z"}}' where slot='bootstrap';
insert into public.matter_page_receipts(stream,receipt_id,fingerprint) values('recent_sessions','00000000-0000-4000-8000-000000000223','synthetic-restore');
insert into public.matter_dirty_rollups(date,revision,timezone) values('2026-05-19','00000000-0000-4000-8000-000000000323','Europe/Athens');
insert into public.matter_invocation_status(trigger,id,attempted_at,outcome) values('scheduled','00000000-0000-4000-8000-000000000423','2026-10-01T00:00:00Z','partial');
`;

export async function rehearseRestore({ source, target, sql, dump, restore, verifyCatalog, verifyDataApi }) {
  assert.notEqual(source, target, 'restore requires a separate disposable target');
  await sql(source, restoreSeedSql);
  const before = await sql(source, restoreSnapshotSql);
  // The dump is kept in memory by the orchestrator, never uploaded or written
  // to the checkout. Source is quiescent, all data is synthetic.
  const backup = await dump(source);
  assert.ok(backup.length > 0, 'empty backup');
  await restore(target, backup);
  assert.equal(await sql(target, restoreSnapshotSql), before, 'restored raw/progress/generation/status state differs');
  await verifyCatalog(target);
  // Run controls after equality: Auth/security fixtures intentionally mutate state.
  await verifyDataApi(target);
  return { status: 'passed', syntheticOnly: true, separateTarget: true, tablesCompared: INVENTORIED_TABLES.length,
    schemaAndSecurity: 'passed', rawAndProgress: 'passed', dataApi: 'passed', backupUploaded: false };
}
