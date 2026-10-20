import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { INVENTORIED_TABLES } from './stabilization-db-runner.mjs';

// All columns, every row, deterministic order. Only hashes/counts leave SQL;
// neither source data nor dumps are evidence artifacts.
export const restoreSnapshotSql = INVENTORIED_TABLES.map(table =>
  `select jsonb_build_object('table','${table}','count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')))::text from public.${table} r;`
).join('\n');

// Refuse a source/live/prepopulated target. This script is only for a NEW
// dedicated Supabase destination; explicit schema dumps recreate both schemas.
export const restoreTargetGuardSql = String.raw`
DO $empty_target$
declare applied bigint;
begin
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','f')
      and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e'))
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')) then
    raise exception 'Restore requires a new target with no app-owned public objects';
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select count(*) from supabase_migrations.schema_migrations' into applied;
    if applied <> 0 then raise exception 'Restore target has applied migrations'; end if;
  end if;
end $empty_target$;
`;
export const restoreTargetPreparationSql = restoreTargetGuardSql + String.raw`
drop schema public cascade;
drop schema if exists supabase_migrations cascade;
`;
export const restoreSourceRefusalSql = `DO $refusal$ begin
  begin
    execute $guard$${restoreTargetGuardSql}$guard$;
    raise exception 'Restore guard accepted source';
  exception when raise_exception then
    if sqlerrm <> 'Restore requires a new target with no app-owned public objects' then raise; end if;
  end;
end $refusal$;`;


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
select public.record_matter_invocation('00000000-0000-4000-8000-000000000423','scheduled','attempted');
select public.record_matter_invocation('00000000-0000-4000-8000-000000000423','scheduled','partial');
`;

export const RESTORE_PHASES = ['synthetic-seed', 'source-snapshot', 'dump', 'restore', 'preservation', 'catalog', 'data-api'];

export async function rehearseRestore({ source, target, sql, dump, restore, verifyCatalog, verifyDataApi, progress }) {
  assert.notEqual(source, target, 'restore requires a separate disposable target');
  const step = async (name, operation) => {
    progress?.begin(name);
    try { const result = await operation(); progress?.end(); return result; }
    catch (error) { progress?.fail(error.failureKind); throw error; }
  };
  await step('synthetic-seed', () => sql(source, restoreSeedSql));
  const before = await step('source-snapshot', () => sql(source, restoreSnapshotSql));
  // The dump is kept in memory, never uploaded or written to the checkout.
  const backup = await step('dump', async () => {
    const value = await dump(source); assert.ok(value.length > 0, 'empty backup'); return value;
  });
  await step('restore', () => restore(target, backup));
  await step('preservation', async () => assert.equal(await sql(target, restoreSnapshotSql), before, 'restored raw/progress/generation/status state differs'));
  await step('catalog', () => verifyCatalog(target));
  await step('data-api', () => verifyDataApi(target));
  return { status: 'passed', syntheticOnly: true, separateTarget: true, tablesCompared: INVENTORIED_TABLES.length,
    schemaAndSecurity: 'passed', rawAndProgress: 'passed', dataApi: 'passed', backupUploaded: false,
    backupIdentity:{schemas:['public','supabase_migrations'],bytes:Buffer.byteLength(backup),sha256:createHash('sha256').update(backup).digest('hex')} };
}
