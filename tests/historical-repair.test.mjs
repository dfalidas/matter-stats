import assert from 'node:assert/strict';
import test from 'node:test';
import { repairConfig,repairStatement } from '../scripts/historical-repair.mjs';
const id='00000000-0000-4000-8000-000000000020';
test('repair operator requires isolated acknowledgement and dedicated connection, without production fallback',()=>{
  for(const target of ['production','isolated',undefined])assert.throws(()=>repairConfig(target,{SUPABASE_URL:'https://production.invalid',SUPABASE_SERVICE_ROLE_KEY:'unused'}));
  const config=repairConfig('isolated',{HISTORICAL_REPAIR_ISOLATED_ACK:'yes',HISTORICAL_REPAIR_ISOLATED_PGSERVICE:'synthetic',HISTORICAL_REPAIR_ISOLATED_PGSERVICEFILE:'/tmp/synthetic.conf',SUPABASE_URL:'unused',PGHOST:'unused',PGOPTIONS:'unused'});
  assert.equal(config.env.PGSERVICEFILE,'/tmp/synthetic.conf');assert.ok(!config.env.PGHOST);assert.ok(!config.env.PGOPTIONS);assert.ok(!config.env.SUPABASE_URL);
});
test('inspection does not prepare/claim/resume, transitions require explicit target generation and epoch',()=>{
  assert.match(repairStatement('status',{}),/^select /);assert.doesNotMatch(repairStatement('status',{}),/repair_prepare|repair_claim|repair_batch/);
  const contract={run:id,owner:id,fence:'9007199254740993',active:'legacy',epoch:'2'};
  assert.match(repairStatement('rollback',contract),/9007199254740993,null::uuid,2,true/);
  for(const override of [{epoch:undefined},{active:undefined},{run:"x';drop table anything;--"},{fence:'1.1'},{fence:'9223372036854775808'}])assert.throws(()=>repairStatement('cutover',{...contract,...override}));
});
