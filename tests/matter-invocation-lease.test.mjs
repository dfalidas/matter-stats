import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalLoad = Module._load;
const calls = [];
Module._load = function (request, parent, ...rest) {
  if (request === 'server-only') return {};
  if (request === './supabase-admin' && parent.filename.endsWith('matter-sync-lease.js')) {
    return { getSupabaseAdminClient: () => ({ rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: [{ generation: '9007199254740993' }], error: null };
    } }) };
  }
  return originalLoad.call(this, request, parent, ...rest);
};
const { acquireMatterSyncLease } = Module.createRequire(import.meta.url)(path.join(root, '.test-build/lib/matter-sync-lease.js'));
Module._load = originalLoad;

test('real lease helper forwards the invocation UUID while preserving TTL and database generation', async () => {
  const id = '3247e6c5-6afa-49c3-bffa-78aeb275c875';
  assert.deepEqual(await acquireMatterSyncLease(id), { accountScope: 'matter', owner: id, generation: '9007199254740993' });
  assert.deepEqual(calls[0], { name: 'acquire_matter_sync_lease', args: { p_account_scope: 'matter', p_owner: id, p_ttl_seconds: 120 } });
  const first = await acquireMatterSyncLease(), second = await acquireMatterSyncLease();
  assert.notEqual(first.owner, second.owner); assert.notEqual(first.owner, id);
});
