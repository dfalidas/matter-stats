import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function sanitizedEnvironment(extra = {}) {
  const keep = ["PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP", "SystemRoot", "COMSPEC", "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "npm_config_cache", "npm_config_https_proxy"];
  return Object.fromEntries([...keep.filter((key) => process.env[key]).map((key) => [key, process.env[key]]), ...Object.entries(extra)]);
}


export function ciIdentity(env, event, testedSha) {
  assert.match(testedSha, /^[a-f0-9]{40}$/);
  const eventName = env.GITHUB_EVENT_NAME ?? 'local';
  const expectedSha = eventName === 'pull_request' ? event.pull_request?.head?.sha : eventName === 'push' ? env.GITHUB_SHA : testedSha;
  assert.ok(['local', 'pull_request', 'push'].includes(eventName), 'unsupported database verification event');
  assert.equal(testedSha, expectedSha, 'checkout differs from the required event commit');
  return {
    testedSha, event: eventName, checkoutKind: eventName === 'pull_request' ? 'pr-head' : eventName === 'push' ? 'main-commit' : 'local',
    prHeadSha: event.pull_request?.head?.sha ?? null,
    // On pull_request GITHUB_SHA is the synthetic merge, NOT the tested DB head.
    eventSha: env.GITHUB_SHA ?? null,
    workflowRun: env.GITHUB_RUN_ID ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
  };
}

export function outcomeCounts(steps) {
  return Object.fromEntries(['passed', 'failed', 'skipped', 'todo', 'blocked', 'not-run', 'running'].map(status => [status, steps.filter(s => s.status === status).length]));
}

// Persist BEFORE executing each phase. A terminated process leaves running/pending,
// never a fabricated successful assertion or cleanup result.
export function phaseRecorder(names, persist) {
  const steps = names.map(name => ({ name, status: 'not-run' }));
  let active;
  const save = () => persist({ steps, counts: outcomeCounts(steps) });
  save();
  return {
    begin(name) {
      assert.ok(!active, 'previous verification phase not completed');
      active = steps.find(step => step.name === name);
      assert.ok(active && active.status === 'not-run', `unknown/repeated phase ${name}`);
      active.status = 'running'; save();
    },
    end() { assert.ok(active); active.status = 'passed'; active = undefined; save(); },
    fail(kind = 'assertion-or-suite') { if (active) { active.status = kind === 'infrastructure' ? 'blocked' : 'failed'; active.failureKind = kind; active = undefined; } save(); },
  };
}

export function executionIdentity(env = process.env) {
  const testedSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', env:sanitizedEnvironment() }).trim();
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  return { ...ciIdentity(env, event, testedSha),
    worktreeDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', env:sanitizedEnvironment() }).trim()),
    node: process.version,
    npm: execFileSync('npm', ['--version'], { encoding: 'utf8', env:sanitizedEnvironment() }).trim(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const identity = executionIdentity();
  const directory = `artifacts/stabilization-db/${identity.testedSha}`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/ci.json`, JSON.stringify({ ...identity, verificationOutcome: process.env.VERIFICATION_OUTCOME ?? 'not-run' }, null, 2) + '\n');
}
