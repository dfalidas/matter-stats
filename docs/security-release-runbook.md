# Current release and recovery runbook

Operational entry point for Tasks 01–23, reviewed 2026-10-20 against main
`323b2d5d956312b7973484b5e5c3f37c14afb9be`. Task 23 changes CI/tooling/docs only.
Executing production migrations, backups, repair, cutover, deployment, credential
rotation or real Matter sync requires separate authorization. No such operation
was performed for this document. Record observations for the actual target;
repository implementation and automatic Git deployment statuses are not production certification.

## Preflight checklist

- [ ] Record exact candidate Git SHA, target/environment identity privately, reviewer,
  maintenance window, abort owner and the compatible application recovery SHA.
- [ ] Read successful checks **for that candidate**: `verify` and
  `Fresh and upgrade database verification` in workflow `CI`. These are the exact
  check names recommended for branch protection. Repository rules were not changed
  or verified here. The application job checks GitHub's PR merge commit; the database
  job checks PR head. On pushes both check the pushed main commit. Retain both SHAs.
- [ ] Inspect sanitized artifact outcomes and cleanup, not just a green status.
  A blocked/not-run/failed database path is an unresolved gate. Verify all 20 ordered
  migrations in `supabase/migrations` against actual target history; latest is
  `20261015141435_truthful_sync_status.sql`. Record actual Postgres/extension,
  PostgREST, platform configuration and exact RPC signatures/ACLs, with the inventories
  in `scripts/*inventory.mjs` and `scripts/stabilization-db-runner.mjs`.
- [ ] Match runtime: supported CI Node 22, exact `package-lock.json`, Supabase CLI
  **2.48.3**, Next **15.5.27**. Capture actual Node/npm/CLI versions. The manifest's
  `>=20.9.0` minimum alone is not evidence that another runtime was tested. Confirm
  Vercel Node/Fluid Compute and the effective 180-second action/cron limits.
- [ ] Confirm names and scope of server-only configuration below. Verify trusted proxy
  forwarding for limiter client identity. Never copy server keys into `NEXT_PUBLIC_*`.
- [ ] Record source coverage uncertainty, partial cycle/checkpoint and retry state,
  frozen/building/active/previous generations, pending dirty revisions and invocation
  evidence. Review [status meanings](task-21-status.md). Do not infer completeness from counts.
- [ ] Identify the encrypted off-site backup, its time/source/schema/candidate identity,
  checksums, scope/exclusions, restore target/version and successful restore validation.
  A synthetic rehearsal is not a production backup. Missing actual backup/restore
  evidence blocks destructive recovery and historical cutover.
- [ ] Keep unresolved audit findings and Task 24/external gates visible. Task 22's
  local npm 11 remediation-metadata failure and CI pass remain separate historical
  results in [its QA record](task-22-qa.md). Compare again with Node 22/npm 10 and
  unchanged policy; never weaken exceptions to obtain green checks.

## Compatibility table

These are capabilities of the implementation, not blanket approval of older releases.
An application rollback must select an exact reviewed SHA and satisfy **all** its
schema, generation, auth and environment contracts.

| Application family | Required schema/read contract | Allowed release/recovery use |
| --- | --- | --- |
| Pre-security / deterministic-cookie releases | Lack revocable hashed sessions and atomic login limiter | Not an approved rollback. Never restore obsolete cookie authentication. |
| Task 11 or earlier sync | Legacy singleton / independent stream without account fencing | Keep all entry points disabled after modern rollout; ordinary old service-role writes bypass cooperative fencing. |
| Task 12 sync | Lease fencing, but separate row/checkpoint mutations | Incompatible writer: lacks atomic page receipts and dirty-work recovery. |
| Task 13–14 sync | Atomic pages; Task 14 adds bounded continuation/history intent | Incompatible with Task 15 shared quota/retry contract. Keep old writers/previews stopped; retaining additive tables is insufficient. |
| Tasks 15–18 | Quota/preparation and canonical raw-session analytics | Older provenance writers can erase known calculation provenance; old persisted-derived readers cannot observe Task 20 generations. Exclude them from a current release. |
| Task 19 | Adds explicit provenance; read-only preview | Preview remains read-only. Application persisted-estimate/daily readers are incompatible after Task 20 generation activation. |
| Task 20 | Generation-pinned article estimate and exported daily helpers; raw-session analytics stay canonical | Requires full Task 20 chain. Its SQL triggers preserve active/previous generations during cooperating ingestion. Does not have Task 21's truthful status UI; not a normal operational rollback when that status is required. |
| Task 21 reviewed final code / Task 22 / Task 23 | Full chain through Task 21; opaque DB sessions; quota/fencing/pages/continuation; generation-aware derived reads and truthful status | Candidate compatible family. Select a reviewed SHA with passing checks and matching configuration. Task 22 changes presentation; Task 23 changes no runtime behavior. |

Overview, Activity, Reports, Metrics/rankings and annual views calculate reading
values from raw sessions. `getArticleDetail` pins generation estimates;
`getDashboardSummary`/`getReadingTrend` use selected daily generations (the latter
helpers are not currently dashboard route readers). Raw SQL/table exports of old
derived columns do not reflect cutover. See the complete
[Task 20 reader/writer inventory](task-20-operator-guide.md#contract-and-inventory).
No older deployment is made compatible merely by leaving migrations installed.

## Release order

1. **Disable ingress before a compatibility boundary.** Pause cron delivery at the
   hosting layer, restrict the cron endpoint and block manual Dashboard/Settings
   recent-sync, library, history and recovery actions. Block old production/preview
   URLs, local jobs, background executions, operator repair/import/SQL writers and
   direct callers using the server role. Inventory actual deployed sources; no
   application maintenance switch is added here. Disable access to repair tooling.
2. **Drain or stop incompatible readers and writers**, including previews and
   already-running functions. Verify executions have stopped. Waiting one 120-second
   lease TTL does not drain older unfenced code. Prevent old deployments resuming.
   For a frozen Task 20 run, inspect its durable state and use its fenced resume or
   cancel procedure; do not clear the barrier by direct UPDATE.
3. **Take the required backup** after quiescing all relevant writes. Record its identity,
   exclusions and restore evidence using the Free-plan procedure below. Keep ingress
   stopped until the recovery point and rollback choice are accepted.
4. **Apply only outstanding migrations, in timestamp order.** Use the full directory,
   not a historical shortened list. Verify the actual target before any approved
   operation. With the pinned CLI, inspect `migration list --help`,
   `migration list --linked`, and `db push --help`; review `db push --dry-run` before
   an authorized `db push` against the deliberately linked target. No migration is
   rewritten, down-migrated or skipped. The two `20260929` migrations precede login
   code; Task 19 provenance precedes Task 20 generations, then Task 21 status.
5. **Verify schema/security/preservation.** Compare migration history and exact table,
   function and view inventory, RLS, PUBLIC/browser denial, intended service grants,
   invoker/search paths (the limiter deliberately remains its reviewed definer), and
   raw/progress/generation snapshots. Use read-only audit
   `supabase/audit/stabilization-read-only.sql` and Security Advisor as authorized.
   Run valid allowance/denial/concurrency probes on an isolated representative target,
   never mutate personal production rows as a permission test. Unexpected objects,
   missing RPCs or failed reads are blockers, not permission-denial evidence.
6. **Configure server-only values** for the compatible application and redeploy only
   after target checks. Release the reviewed compatible code with ingress still
   stopped. Verify old readers/writers remain inaccessible. No repair begins merely
   because its migration is installed.
7. **Controlled verification**: record deployed SHA, schema/configuration/toolchain,
   login failure/success/outage, logout/replay, private page and server action guards,
   missing/wrong Bearer cron rejection, ordinary queries and truthful status. Task 24
   owns staging end-to-end verification; this checklist does not mark it complete.
   Real sync/repair/cutover needs its own authorization and bounded plan.
8. **Resume only permitted triggers** when all compatibility and release gates pass.
   Preserve `0 6 * * *` **UTC**, `GET /api/cron/sync-recent-activity`, exact
   `Authorization: Bearer <CRON_SECRET>`; no query secret. Observe two real scheduled
   cycles separately. A page-budget stop is partial work with durable continuation;
   do not reset it or label it verified historical coverage.

## Server configuration

| Name | Contract |
| --- | --- |
| `APP_ACCESS_PASSWORD` | Server login secret; pair an authorized change with incrementing `APP_CREDENTIAL_VERSION`. |
| `APP_CREDENTIAL_VERSION` | Positive integer, initially `1`; invalidates older database sessions on increment. Never decrease to revive sessions. |
| `APP_TIMEZONE` | Valid IANA zone, default `Europe/Athens`; generation timezone must match. Changing it requires explicit compatible recomputation planning. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-only target/key; no browser client or public copy. |
| `MATTER_API_TOKEN`, `CRON_SECRET` | Server-only Matter and exact Bearer cron credentials. |
| `MATTER_SYNC_ITEMS_LIMIT`, `MATTER_SYNC_SESSIONS_LIMIT` | Strict integer 1–100, default 25; active request contracts retain their pinned limits. |
| `MATTER_SYNC_STALE_HOURS` | Optional positive elapsed hours, default 36; warning at `>=` threshold. |

Dedicated preview/repair libpq services are separate operator configuration; they
never fall back to application credentials. Consult [Task 19 preview](task-19-preview.md)
and [Task 20 operator commands](task-20-operator-guide.md#isolated-operator-commands).
The repair executable currently permits **isolated synthetic targets only**. Do not
remove that refusal or relabel a production service as isolated.

## Free-plan backup and restore

Supabase's current [backup guidance](https://supabase.com/docs/guides/platform/backups)
recommends CLI exports and off-site storage for Free projects. Do not assume paid
retained backups or PITR exist. Its [manual logical restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
uses schema, data and role dumps, with migration history exported separately.
CLI schema-only output is not a data backup. Managed Auth/Storage/extension schemas
have special exclusions/customization handling, and Storage object bytes are not
in a database dump. Project/Vercel environment configuration, API credentials,
custom role passwords and encryption root keys are separate recovery materials.
Vault/pgsodium use requires a separately approved key-recovery plan; dumps alone
cannot restore decryptability. None is established by this repository.

For this application, all app tables/RPCs/triggers, opaque-session hashes,
limiter history, raw reading/library data, provenance, generations/captures,
checkpoints, leases, quota/retry caches, receipts and status evidence live in
`public`. Preserve `supabase_migrations` alongside it. The bounded rehearsal below
covers **these two schemas**, including ACLs/RLS/functions/triggers/sequence state;
it is not a full Supabase platform clone. Before release, inspect the actual target
for other schemas, custom roles/extensions, managed-schema changes or Storage use.
If present, extend the privately reviewed backup scope and rehearsal first.

A separately authorized operator can use the pinned CLI's project-role-aware
exports below. CLI **2.48.3** filters managed-role defaults and emits compatible
schema creation commands; unfiltered PostgreSQL clean/ownership commands are not
this procedure. Verify the actual source server major and the CLI dump image/client
major first. Use direct/session connections with verified TLS; transaction poolers
are unsuitable. The separate `psql` restore uses dedicated libpq service/password
files **outside the checkout**, owner-readable only.

Prepare a private CLI workdir outside the repository, deliberately linked to the
approved source using the pinned `init`/`link` commands. Review its target identity
before every export. Supply `SUPABASE_DB_PASSWORD` through a private credential
manager or hidden CLI prompt, never a connection URL or command-line password.
No source linking or hosted backup was performed for Task 23. The current app owns
only `public`; stop and review scope if the actual source has other custom schemas.

```sh
# PRIVATE_BACKUP_PROJECT is the reviewed, privately linked CLI workdir.
# BACKUP_DIR and RESTORE_PREFLIGHT are new paths in private encrypted storage.
umask 077
supabase --version                 # must report 2.48.3
psql --version
supabase --workdir "$PRIVATE_BACKUP_PROJECT" db dump --linked \
  --keep-comments --file "$BACKUP_DIR/schema.sql"
supabase --workdir "$PRIVATE_BACKUP_PROJECT" db dump --linked \
  --schema supabase_migrations --keep-comments --file "$BACKUP_DIR/history-schema.sql"
supabase --workdir "$PRIVATE_BACKUP_PROJECT" db dump --linked \
  --schema public,supabase_migrations --data-only --use-copy --file "$BACKUP_DIR/data.sql"
sha256sum "$BACKUP_DIR/schema.sql" "$BACKUP_DIR/history-schema.sql" \
  "$BACKUP_DIR/data.sql" > "$BACKUP_DIR/checksums.sha256"
# Generate the reviewed new-target guard/default-grant preparation, no connection:
node --input-type=module -e 'import {restoreTargetPreparationSql} from "./scripts/disposable-restore.mjs"; process.stdout.write(restoreTargetPreparationSql)' > "$RESTORE_PREFLIGHT"
# isolated_restore must be a NEW, dedicated Supabase destination, never the source.
psql -X --dbname='service=isolated_restore' --single-transaction \
  --variable ON_ERROR_STOP=1 --file="$RESTORE_PREFLIGHT" \
  --file="$BACKUP_DIR/schema.sql" --file="$BACKUP_DIR/history-schema.sql" \
  --file="$BACKUP_DIR/data.sql" --command "NOTIFY pgrst, 'reload schema';"
```

The destination guard refuses app-owned public objects or migration objects. Do not
apply app migrations or initialize migration history in that new destination first.
It retains the platform's `public` schema and limits the restoring role's default
grants before creating app objects. Source ACLs, RLS and function properties must
then pass the catalog and real Data API controls. The rehearsal proves the guard
rejects its populated source. Never use preparation/restoration on the source/live
database. Retain ACLs; never omit them merely to make restoration succeed.

The native data export establishes `session_replication_role=replica` immediately
before loading data and resets session settings afterward. This offline restore
transaction prevents source-maintenance triggers from double-applying generations.
Normal release/rollback never bypasses these triggers. No RLS policy is disabled.

Quiesce writes for the whole export and record a consistent recovery point. These
separate exports require a quiescent source throughout; export externally used custom
roles/configuration separately, without managed-role password/ownership conflicts.
The repository uses standard Supabase roles; no new custom login is created here.
The alternative official CLI commands `db dump --role-only`, default schema dump,
`db dump --data-only --use-copy`, and explicit `--schema supabase_migrations` exports
are supported by **2.48.3 --help**, but require separate reviewed scope/restore
handling for managed schemas. Do not paste current-doc flags unavailable in the pin.

Store backups encrypted off-site with restricted access, retention and integrity
checks. Keep credentials and any encryption keys separately protected; treat
session hashes, cached responses and source identifiers as private data. Never
commit/upload backups, dumps, service/password files, `.env` or raw logs as CI evidence.
Record only backup identity/checksum/size/time/scope and sanitized validation.

Restore verification must compare **all columns/row counts** for every app table,
raw IDs, durations, UTC timestamps, relationships, provenance and derived generation
state, as well as checkpoints, lease/cycle generations, quota/backoff/retry state,
receipts and status evidence. Verify migration history/catalog/RLS/ACL/search paths,
service allowance, anon/authenticated denial with valid fixtures, then compatible
application reads. Check pending/frozen work and restore-era leases before any
resumption; recovering an older generation can invalidate later fences. Keep **all**
pre-recovery workers dead, not just expired. Document the recovery-point data loss.

### Bounded synthetic rehearsal

```sh
npm ci
DISPOSABLE_DB_ACK=yes npm run test:stabilization-db
```

After fresh schema/catalog setup, the existing runner seeds a small synthetic
raw/progress fixture before the longer integration suites and exercises the existing bounded Task 20 generation engine.
It captures the native CLI schema, migration-history schema and scoped data exports
from its fresh stack in memory, restores
into a third, separately owned local **Supabase** stack, compares every app table,
checks the catalog and reuses the real Auth/Data API permission assertions for every
restored table plus generation/retry read controls. Full CRUD and limiter concurrency
checks already ran on both fresh/upgrade sources.
The restore stack is removed before starting upgrade. Only the owned synthetic
fresh source is then reset through the existing full migration path before all
original fresh/upgrade integration suites run. The rehearsal
uses the pinned CLI's native local export and the matching target psql; neither dumps nor generated
keys are retained. Snapshot equality precedes any security-fixture mutations.
This is separate from Task 24's UI flow. Only a completed `backup-restore.json`
and verified cleanup establish a successful rehearsal. Synthetic success does
**not** establish that production has a backup, or that a production restore works.

## Rollback decision and sequence

| Recovery | Trigger and prerequisites | Sequence and verification |
| --- | --- | --- |
| Compatible application rollback | Application regression; exact reviewed Task 21/22 recovery SHA passes required checks, current schema/generation/auth/environment compatible | Disable all affected ingress, drain/stop current and old instances, record progress/status, restore compatible application code/configuration, verify auth/replay, reads, status and server-role access, then selectively resume. Keep every installed migration and all durable state. |
| Task 20 derived-generation rollback | Faulty active derived result; maintained immediate predecessor exists; no outstanding repair/barrier; current owner/fence and expected active/epoch reviewed; backup/restore evidence retained | Stop affected readers/writers, inspect status and reconcile prerequisites. Use the existing fenced `repair_transition(..., p_rollback=true)` mechanism via the isolated operator workflow only; production execution remains a separately gated workflow. Verify pointer/epoch, generation-aware readers and preserved raw/progress/status evidence before resuming. Never select a retired/unmaintained generation by direct UPDATE. |
| Database recovery from backup | Migration/data corruption prevents safe roll-forward; authorized recovery point, verified backup identity/scope and isolated restore exist | Stop **all** readers/writers/previews/jobs; preserve incident evidence and any newer recoverable data. Restore to a separate target, verify schema/security/all raw/progress invariants and compatible application reads, approve documented lost writes and configuration/target switch, release compatible code, then resume permitted triggers. Keep the original target isolated for investigation. |

Task 20 rollback is a **reconciled** rollback: untouched captured session estimates
restore exactly; subsequent ingestion is retained canonically in the maintained
pair. After session mutations, baseline reading dates are conservatively canonical,
not a promise to reactivate stale daily totals. Original captures remain immutable;
unrelated daily metadata and raw sessions are preserved. See
[the exact mechanism and limits](task-20-operator-guide.md#cutover-and-rollback).
Never delete progress, reset a cursor/lease/quota/history generation, clear receipts,
drop additive tables, disable RLS or restore deterministic cookies as routine rollback.

[Vercel Instant Rollback](https://vercel.com/docs/instant-rollback) reassigns an
eligible previous production deployment; it does **not** undo database migrations,
raw data or derived cutover. It reuses the old build/environment values, not current
project-setting edits; cron configuration also reverts with the deployment. Hobby
eligibility is limited to the immediately previous deployment. Verify its exact
SHA, configuration/auth version, compatible schema and `0 6 * * *` UTC schedule
before choosing it. Vercel [rollback behavior](https://vercel.com/docs/cli/rollback)
turns off automatic production-domain assignment until promotion resumes it;
confirm the actual dashboard state. A rollback does not drain already-running
functions or protect old deployment URLs. No Vercel CLI is pinned in this repo;
use a separately reviewed operator tool version/dashboard, not an unverified CLI
command copied from old notes.

## Isolated CI and evidence contract

CI keeps existing action SHAs and Supabase CLI 2.48.3. It uses only runner-owned
local Docker/Supabase and synthetic data, no hosted/application/Matter credentials.
`contents: read`, checkout `persist-credentials: false`, no `pull_request_target`.
Ordinary `npm run test` stays database-free; the database job runs
`test:stabilization-db` once, compiling integration prerequisites without repeating
the application tests. Explicit acknowledgement and dedicated `STABILIZATION_TEST_*`
variables remain required. Child environments strip application secrets and
unintended database targets; Data API security checks refuse non-loopback URLs.

Fresh runs all migrations. Upgrade begins at **20260519090000** and retains the
existing intermediate Task 11–15/19–21 preservation comparisons. The same security,
login concurrency, leases, atomic pages/rollups, canonical word boundaries,
continuation, quotas, preview, repair/generation rollback and status suites run on
both. Catalog discovery rejects any non-extension public app relation/view or
function outside explicit coverage. There are currently **no app views**.
Service-role TRUNCATE is rejected for all protected additive state, including
Task 20 generation/capture tables; legacy ALL-grant tables retain their contract. Real
negative controls add a table/view/function overload inside rollback-only SQL
transactions and require the exact uncovered-object failure; a temporary service-role
TRUNCATE grant must also fail the same catalog check. Valid operation
controls and object-specific `42501` denials remain mandatory; malformed payloads,
missing RPCs, transport or unrelated SQL errors never count as successful denials.

`artifacts/stabilization-db/<actual-tested-sha>/` retains sanitized JSON only:
identity/event/head/event-merge-or-main SHA, dirty-worktree flag, workflow run and
attempt, actual tool versions, migration inventories, per-phase outcomes and
suite reports, backup/restore and owned cleanup. Phase counts are **groups**, not
individual assertions. Passed, failed, skipped, TODO, blocked and not-run are
separate; an interrupted phase stays `running` and cleanup stays pending/unverified.
Known infrastructure categories (image pull, disk, timeout, transport) remain
separate from assertion/suite failures. No automatic fallback or unlimited retry.
Artifacts are retained for 14 days; inspect/download before expiration. Never add
raw logs, dumps, generated environments or credentials to the upload allowlist.

## Historical evidence and remaining external gates

Historical results retain their original SHA/date in
[dependency baseline](history/dependency-baseline-2026-10-03.md),
[Task 19 validation](task-19-validation.md), [Task 20 validation](task-20-validation.md),
[Task 21 validation](task-21-validation.md) and [Task 22 QA](task-22-qa.md).
Task 23's [requirements and actual validation](task-23-validation.md) supersedes old
release commands; earlier evidence does not certify a new candidate.

Still separate: review/merge approval and final-head required checks; **Task 24
staging end-to-end verification**; actual production migration/configuration/runtime
and backup/restore checks; a separately authorized production preview/repair/cutover
workflow with invalid-data policy and explicit expected epoch/generation approval;
and **two real scheduled cycles** demonstrating delivery/continuation. Existing
partial sync may continue under its durable mechanism when authorized. Historical
Matter coverage and unsupported item attribution remain unverified. Do not reset
partial state or equate successful imports, reconciled stored data or Git integration
statuses with verified complete history or production readiness.

Schema restore explicitly requests a [PostgREST schema cache reload](https://supabase.com/docs/guides/troubleshooting/refresh-postgrest-schema); missing RPCs after restore remain failures.

Official sources checked 2026-10-20: Supabase [backups](https://supabase.com/docs/guides/platform/backups),
[logical restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[CLI dump](https://supabase.com/docs/reference/cli/supabase-db-dump),
[Data API security](https://supabase.com/docs/guides/api/securing-your-api);
GitHub [event SHAs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
[checkout v4.2.2](https://github.com/actions/checkout/tree/v4.2.2);
Vercel [Instant Rollback](https://vercel.com/docs/instant-rollback),
[rollback](https://vercel.com/docs/cli/rollback). [Pinned CLI schema/data export filters](https://github.com/supabase/cli/tree/v2.48.3/pkg/migration/scripts)
were reviewed for project-role compatibility. PostgreSQL dump/restore behavior was also checked against the official
[PostgreSQL 17 source](https://github.com/postgres/postgres/tree/REL_17_STABLE/src/bin/pg_dump).
CLI flags were checked with the
actual 2.48.3 `--help`; no pin, dependency or audit policy was upgraded.
