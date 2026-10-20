import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { INVENTORIED_TABLES } from '../../scripts/stabilization-db-runner.mjs';
import { assertGrantDenied, assertSuccessful } from './supabase-security-assertions.mjs';

// Focused restore control: never rewrites restored source/progress to make the
// ordinary CRUD fixture fit. Full CRUD/limiter suites ran on both source paths.
assert.equal(process.env.DISPOSABLE_DB_ACK, 'yes');
assert.match(process.env.STABILIZATION_TEST_SQL_PROJECT ?? '', /^matter-stats-restore-[a-z0-9-]+$/);
const url = process.env.STABILIZATION_TEST_SUPABASE_URL;
assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));
const options = { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} };
const service = createClient(url,process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY,options);
const anon = createClient(url,process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY,options);
const authenticated = createClient(url,process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY,options);
let user;
try {
  const email = `restore-${crypto.randomUUID()}@example.invalid`, password = `Synthetic-${crypto.randomUUID()}!aA1`;
  const created = await service.auth.admin.createUser({email,password,email_confirm:true});
  assertSuccessful(created,'create restore Auth control');user=created.data.user.id;
  assertSuccessful(await authenticated.auth.signInWithPassword({email,password}),'restore authenticated control');
  for (const table of INVENTORIED_TABLES) {
    assertSuccessful(await service.from(table).select('*').limit(1), `restored service SELECT ${table}`);
    for (const [role,client] of [['anon',anon],['authenticated',authenticated]]) {
      assertGrantDenied(await client.from(table).select('*').limit(1),{role,operation:'SELECT',kind:'table',name:table});
    }
  }
  const controls = [
    ['read_matter_generation_status',{}],
    ['read_matter_retry_status',{p_now:'2026-10-01T00:00:00Z'}],
    ['read_generation_days',{p_generation:null,p_after:null,p_since:null,p_limit:1}],
  ];
  for (const [name,args] of controls) {
    const result = await service.rpc(name,args);assertSuccessful(result,`restored service ${name}`);
    assert.ok(result.data != null, `restored ${name} missing result`);
    for (const [role,client] of [['anon',anon],['authenticated',authenticated]]) {
      assertGrantDenied(await client.rpc(name,args),{role,operation:'EXECUTE',kind:'function',name});
    }
  }
} finally {
  if (user) assertSuccessful(await service.auth.admin.deleteUser(user),'restore Auth cleanup');
}
console.log(JSON.stringify({status:'passed',tables:INVENTORIED_TABLES.length,rpcControls:3,cleanup:'passed'}));
