# Task 24 reproducible verification

Use a disposable checkout without `.env`, `.env.local` or `.env.production*` files,
Node **22** / npm **10**, local Docker and the repository's pinned Supabase CLI
**2.48.3** (selected by the existing runner's `npx --yes supabase@2.48.3`). Do not
supply application, hosted Supabase or real Matter credentials. Inherited application
variables are stripped before launching CLI/build/server children. No target URL
argument is accepted; the harness creates its own stack below the OS temporary
directory, checks loopback targets and refuses pre-existing owned-name resources.

```sh
npm ci
npx --no-install next typegen
npm run typecheck
npm run lint
npm run test
npm run build
npm run audit:ci
npx --no-install playwright install --with-deps chromium
DISPOSABLE_DB_ACK=yes npm run test:full-stack
# Includes npm run build and next start; never next dev.
DISPOSABLE_DB_ACK=yes npm run test:stabilization-db
git diff --check
```

CI explicitly selects `STABILIZATION_TEST_IMAGE_REGISTRY=docker.io` for both
isolated database jobs. CLI 2.48.3 supports this official registry through
`SUPABASE_INTERNAL_IMAGE_REGISTRY`; the wrapper forwards only the reviewed enum
value and retains the CLI's exact image tags. The default ECR registry returned
`toomanyrequests: Rate exceeded` during Task 24; the same pinned Postgres image's
Docker Hub manifest was reachable. Local operators can prefix the two disposable
commands with `STABILIZATION_TEST_IMAGE_REGISTRY=docker.io`. No production
configuration or application dependency changes. Never pass an arbitrary mirror.

The separate `CI` jobs are `verify`, `Fresh and upgrade database verification`,
and **`Isolated browser and Supabase verification`**. These are proposed check
names only; no branch protection is changed or claimed configured. The browser
job checks PR head or pushed main SHA, uses Node 22, `npm ci`, pinned Playwright's
Chromium and the existing action pins, with `contents: read` and checkout credentials
not persisted. No `pull_request_target`, environment/hosted credentials or production
data. It does not rerun the application test suite or Task 23's database suite.
Those required suites remain in their separate existing jobs.

## Isolation, faults and bounds

`task24-full-stack.mjs` creates one owned stack using Task 23's configuration,
migration, SQL, catalog and gateway helpers. CLI bootstrap credentials are local;
the CLI's 40-character project-ID bound is asserted before resource creation.
The browser stack retains real Postgres, PostgREST, Kong and Auth; unused Studio,
Storage, Realtime, image proxy, email, analytics, vector, Edge Runtime, pooler and
postgres-meta containers are excluded with the reviewed CLI flag. Task 23's full
fresh/upgrade/restore services and assertions remain intact.
The application uses a fresh signed service-role JWT and generated app/cron/Matter
credentials. The normal database transport is real. Seeded analytics and supplementary
status states use SQL on that owned stack. Sync uses actual production actions,
the actual HTTP cron route and the production ingestion/RPC chain.

`task24-app.mjs` is a test-only Node entry point launched with a private IPC channel.
It installs a fetch controller before starting Next and blocks external TCP. Synthetic
Matter responses travel over IPC, never to Matter. Unknown destinations/paths fail
closed. There is no public test endpoint, deployable bypass, API-base environment
override, authentication replacement or browser Supabase client. Only deliberate
faults interrupt selected real database requests; successful database responses are
never substituted. The browser permits only the application origin and stores no
trace, HAR, storageState or cookies on disk. Secure cookies are verified in Chromium's
trustworthy `http://localhost` context without changing cookie attributes or auth.

Fixture sizes and page counts are fixed. Commands have the reused 20-minute ceiling;
startup has 150 bounded attempts, browser actions have timeouts, HTTP cron has 175 s,
process shutdown escalates after 5 s, and the CI job has 35 minutes. Fault waits honor
the persisted natural eligibility deadline with an explicit <65-second ceiling.
Production quotas, request timeouts, budgets, fences and durable state are unchanged.
No fixture recovery clears quotas, cursor state or successful preparation. Selected
app process restarts retain the same database and real browser session. Detailed
stale-fence/page-atomicity/retry cases remain in Task 23's real DB suites.

Always inspect `cleanup.json`. Only this invocation's exact project and temporary
directory are removed. Never run `supabase stop --all`, Docker prune or remove
unrelated resources. A killed machine/job may leave cleanup pending/unverified;
inspect and stop only the recorded owned project using private local metadata.

## Evidence handling

Each invocation writes `artifacts/task24/<actual-checkout-sha>/<timestamp>/`. Identity
records base/application/build/harness/checkout SHA, dirty flag and harness content
hashes, event/run/attempt and environment type. Actual Node/npm/CLI/Next/Playwright/
Chromium versions, migration inventory, build ID and journey/group outcomes are
separate. Application test counts come from `verify`, browser behavioral counts from
`journeys.json`, database phase-group counts from `database.json`, overall harness
groups from `outcomes.json` and Task 23's separate artifacts.
Do not add these unlike units into one total.

The workflow explicitly allows only named sanitized JSON files and seven selected
screenshots. Phase state is written before execution. Infrastructure-blocked,
assertion-failed, skipped, TODO, not-run and running remain distinct; unsuccessful
prerequisites/assertions exit nonzero. Success and failure both retain sanitized
outcome/cleanup/browser/network reports. Local `work/task24-private-failure.txt` is
restricted debugging material and **never** an artifact or committed evidence.
App subprocess logs are counted, not retained. Inspect screenshot content before
committing or sharing it; the manifest initially marks visual inspection pending.

Never publish environment files, private URLs/project IDs, generated credentials,
captured cookies/session hashes, storageState, database dumps, raw logs, HAR/traces,
upstream tokens/cursors or personal data. Download/inspect CI artifacts before their
14-day expiration and retain only the allowlisted evidence you need. Preserve failed
attempts at their original identity; rerun affected checks after implementation edits.

## Actual hosted staging gate

**BLOCKED / NOT RUN:** discovery on 2026-10-21 found one Vercel app and only a
production-named Supabase database, zero Supabase development branches and zero
Vercel custom environments. Recovery discovery confirmed the same state. Ready
previews do not establish DB isolation.
No hosted runtime request, mutating check or environment read of secret values was
performed. No service was provisioned, configuration changed or production data
created/copied. Existing Git integration generated automatic preview statuses on
branch pushes; no manual deployment/promotion was performed. Those statuses were
not treated as runtime verification or proof of database isolation.

The minimal operator setup, outside this task's execution authorization, is:

1. Identify an existing separately authorized staging application **and** isolated
   database. Record their identities privately, prove the DB differs from production,
   confirm empty/synthetic ownership and set an abort/cleanup owner. A preview using
   production Supabase is ineligible. Provisioning/paid services require separate work.
2. Supply fresh staging app password, credential version, server key, synthetic Matter
   token and cron secret through the approved private secret mechanism, never Git/chat
   artifacts. Apply the same full 20-migration chain to that isolated DB only after
   approval; preserve production server authorization and Secure cookies.
3. Verify deployed Git SHA/build identity and configuration scope from hosting metadata
   and operator records. Confirm APP_TIMEZONE Europe/Athens and cron `0 6 * * *` UTC.
   A successful deployment status alone is insufficient.
4. Establish a reviewed **test-process-only** synthetic transport on the staging Node
   process and network denial for real Matter before any sync. The local IPC wrapper
   is not a Vercel production feature. If the hosted runtime cannot support an equally
   isolated test transport, leave hosted sync/fault journeys blocked; never add an
   API-base override/test endpoint or use a real token to get a pass. This prerequisite
   needs an operator-owned staging execution mechanism and is not supplied by previews.
5. On the verified hosted HTTPS origin, execute the matrix: protected redirects and
   wrong/limited/correct login; cookie attributes and real DB hash; real metadata/session
   synthetic seed; independent Reports CSV vectors and mobile/desktop navigation;
   manual sync/library/history controls; missing/wrong/query-only cron rejection then
   synthetic Bearer invocation; partial/restart/resume, double-run, 429/timeout/
   interruption/recovery; status outages; logout and captured-cookie replay rejection.
   Use the same independent fixture values and small bounded scenarios; inspect DB
   rows/receipts/checkpoints/rollups privately after each transition. Never transplant
   the local runner's permissive credentials or point its DB command at a hosted URL.
6. Record actual deployed SHA, runtime/toolchain/migrations/configuration scope, per-
   journey outcomes and inspected screenshots with the same artifact allowlist; remove
   only staging-owned synthetic resources and verify cleanup. Mark C passed only after
   every required hosted journey has direct evidence. An invoked cron route still does
   not prove Vercel scheduled delivery. Production and two actual cycles remain D.

Do not manually deploy/reconfigure/promote, copy production data, perform production
SQL/backup/repair/cutover, rotate secrets or run real Matter under Task 24. Review and
merge approval are separate from this reproducible verification procedure.
