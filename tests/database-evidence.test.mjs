import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ciIdentity, phaseRecorder } from '../scripts/database-evidence.mjs';
import { rehearseRestore } from '../scripts/disposable-restore.mjs';
const head = 'a'.repeat(40), merge = 'b'.repeat(40);

test('PR evidence tests head and retains the distinct synthetic merge identity', () => {
  const result = ciIdentity({GITHUB_EVENT_NAME:'pull_request',GITHUB_SHA:merge}, {pull_request:{head:{sha:head}}}, head);
  assert.equal(result.checkoutKind, 'pr-head'); assert.equal(result.eventSha, merge); assert.equal(result.testedSha, head);
  assert.throws(() => ciIdentity({GITHUB_EVENT_NAME:'pull_request',GITHUB_SHA:merge}, {pull_request:{head:{sha:head}}}, merge), /checkout differs/);
});
test('push evidence requires the pushed main commit; unrelated events fail closed', () => {
  assert.equal(ciIdentity({GITHUB_EVENT_NAME:'push',GITHUB_SHA:head}, {}, head).checkoutKind, 'main-commit');
  assert.throws(() => ciIdentity({GITHUB_EVENT_NAME:'push',GITHUB_SHA:merge}, {}, head), /checkout differs/);
  assert.throws(() => ciIdentity({GITHUB_EVENT_NAME:'pull_request_target'}, {}, head), /unsupported/);
});
test('workflow preserves pins, both event checkouts, least privilege and one app test execution', () => {
  const workflow = readFileSync('.github/workflows/ci.yml','utf8');
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.equal((workflow.match(/npm run test\n/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|if:.*event_name.*pull_request/);
  assert.match(workflow, /permissions:\n  contents: read/);
});
test('phase evidence separates failed, blocked and not-run; interrupted work stays running', () => {
  let report;
  const recorder = phaseRecorder(['catalog','security','restore'], data => { report = structuredClone(data); });
  recorder.begin('catalog');recorder.end();recorder.begin('security');recorder.fail('infrastructure');
  assert.deepEqual(report.counts, {passed:1,failed:0,skipped:0,todo:0,blocked:1,'not-run':1,running:0});
  recorder.begin('restore');assert.equal(report.counts.running, 1);
  recorder.fail('assertion-or-suite');assert.equal(report.counts.failed,1);
});
test('restore never accepts source as target; mismatches or failed security controls propagate', async () => {
  const common = {source:'owned-source',target:'owned-target',sql:async()=> 'snapshot', dump:async()=> 'synthetic-backup',restore:async()=>{},verifyCatalog:async()=>{},verifyDataApi:async()=>{}};
  await assert.rejects(rehearseRestore({...common,target:common.source}), /separate disposable/);
  await assert.rejects(rehearseRestore({...common,sql:async(project)=>project}), /state differs/);
  for (const name of ['dump','restore','verifyCatalog','verifyDataApi']) {
    await assert.rejects(rehearseRestore({...common,[name]:async()=>{throw new Error(`failed ${name}`);}}), new RegExp(`failed ${name}`));
  }
  assert.equal((await rehearseRestore(common)).status,'passed');
});

test('infrastructure classification distinguishes capacity, image, transport and assertion failures', async () => {
  const {commandFailureCategory} = await import('../scripts/stabilization-db-orchestrator.mjs');
  for (const [message,category] of [['no space left on device','disk-capacity'],['failed to register layer','image-pull'],['connect ETIMEDOUT','timeout'],['fetch failed','transport'],['AssertionError [ERR_ASSERTION]','assertion'],['unexpected SQL syntax error','execution']]) assert.equal(commandFailureCategory(message), category);
});
