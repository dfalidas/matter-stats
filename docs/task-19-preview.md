# Task 19: provenance and historical repair preview

Task 19 / W6-A / R7,R8 adds a method contract and **read-only** reconciliation. It
is not the Task 20 repair engine. Nothing here invokes Matter, sync, a lease,
checkpoint, status, dirty marker or audit writer. Production reads and migrations
were not executed for this assignment.

## Version and provenance contract

`lib/estimation-contract.json` is the shared machine-readable policy:

- `session-duration-225-round-v1`: fixed 225 WPM, precisely
  `Math.round(duration_seconds / 60 * 225)` for each valid stored session, then sum.
  Duration storage is a non-negative integer; zero and unlinked sessions are valid.
  No article/progress multiplication; nullable article `word_count` remains metadata.
- `local-occurrence-day-v1`: `APP_TIMEZONE`, default `Europe/Athens`; UTC source
  timestamps unchanged. Local calendar boundaries are `[start,end)`. Assign the
  whole duration to the occurrence date, with no inferred interval or split.
  Weeks begin Monday; months/years follow that same local calendar.

New session normalizations carry nullable `word_estimation_method`. Daily reading
aggregates carry nullable `reading_provenance` containing `wordMethod`,
`calendarMethod`, `timezone`. It describes **only** reading duration, estimated
words and session count, not article/highlight/source fields. Production rollup
calculation rejects invalid historical durations rather than persisting a falsely
canonical zero. Both fenced upsert RPCs, their internal atomic page/ack callers,
and the page field validator accept/persist this metadata. The existing exact
function inventories still cover every modified function; no new API, table,
trigger, policy, state machine or grants to browser roles are added.

Existing rows receive NULL, with no default or historical UPDATE. NULL is
legacy/unknown even if the stored value happens to match. An explicit unfamiliar
session version is `other`; an unknown daily calendar version cannot be used to
infer the old timezone. Old-compatible writers omit metadata and overwrite it
with NULL rather than retaining a stale canonical claim. A constraint rejects a
canonical session tag whose words do not match the duration formula. It uses
binary64 division then multiplication and explicit ties-up rounding to match
JavaScript, rather than PostgreSQL numeric arithmetic or float ties-to-even. Provenance
is a trusted writer assertion, not cryptographic proof of historical correctness.

Apply `20261014084407_estimation_provenance.sql` after the complete existing chain
(including Task 15), before this application code. Applied migrations are untouched.
Disable/drain old ingestion and rollup workers for a reviewed rollout; deploy
compatible code, then re-enable. Prior code tolerates extra columns and retains
its old RPC signatures, but its writes clear provenance and may reject the new
page fields if paired with an older database. A code rollback retains the nullable
columns and updated RPCs; do not drop metadata or run a historical rewrite.

## Operator configuration and commands

The CLI requires Node (the locked project dependencies are unchanged) and `psql`
15+ on PATH. Use a **dedicated** libpq service file and dedicated SELECT-only
login, separate from application service-role credentials. Grant only CONNECT,
USAGE on public, and SELECT on `reading_sessions`/`daily_stats` through a reviewed
server-only role; table RLS must permit that dedicated server role (e.g. a reviewed
BYPASSRLS reader). Do not grant it to PUBLIC/anon/authenticated or add permissive
browser policies. Provisioning that reader is a separate production gate; this
PR does not create a login, secret or RLS bypass. Keep service/password/CA files
outside the checkout, owner-readable only; use verified TLS (`sslmode=verify-full`)
for remote connections. Do not put a password in command arguments. The service
file should specify host, port, dbname, user, SSL trust and dedicated passfile.

Use a direct connection or **session** pooler so the transaction remains on one
connection; see official Supabase connection guidance. Arbitrary application
credentials, `PGHOST`, `PGOPTIONS`, `PGSERVICE`, `PGPASSFILE`, startup rc files,
Matter tokens and application secrets are not forwarded. Service files are
trusted operator configuration and must not select production for isolated tests.
There is no URL/key fallback of any kind.

An isolated example (the service `synthetic_preview` must point only at the
operator's disposable database):

```sh
npm ci
mkdir -p work/preview
HISTORICAL_PREVIEW_ISOLATED_PGSERVICE=synthetic_preview \
HISTORICAL_PREVIEW_ISOLATED_PGSERVICEFILE=/absolute/private/isolated-pg-services.conf \
node scripts/historical-preview.mjs --target isolated \
  --start 2025-12-01 --end 2027-02-01 --timezone Europe/Athens \
  --out work/preview/isolated
```

Prepared production command, **not executed in this assignment**, usable only
once production read access is separately approved/provisioned:

```sh
mkdir -p work/preview
HISTORICAL_PREVIEW_PRODUCTION_READ_ACK=yes \
HISTORICAL_PREVIEW_PRODUCTION_PGSERVICE=production_preview_reader \
HISTORICAL_PREVIEW_PRODUCTION_PGSERVICEFILE=/absolute/private/production-pg-services.conf \
node scripts/historical-preview.mjs --target production \
  --start 2020-01-01 --end 2027-01-01 --timezone Europe/Athens \
  --out work/preview/production
```

`--end` is exclusive; timezone is mandatory and invalid dates/zones are rejected,
not replaced by the application default. No default range, target or connection.
Outputs are `<out>.json` and `<out>.txt`; parent directory must exist. Exit 0 =
complete, exit 2 = complete source read but invalid rows prevent full reconciliation,
exit 1 = failure/incomplete input/no completed report from this invocation. Use a
new output basename for each invocation; a previous report is not evidence of a
failed invocation. Never commit real reports or their fingerprints/identifiers.

## Snapshot, bounds and preservation

One `psql -X`, ON_ERROR_STOP connection runs `REPEATABLE READ READ ONLY` and
streams PostgreSQL COPY text, then ROLLBACK. Its snapshot ID, transaction as-of,
row counts, isolation and read-only state are recorded and verified. `row_security=off` rejects a reader that would be subject to row filtering, instead of accepting an incomplete RLS-visible subset. Independent
paginated Data API requests are deliberately not used: neither short pages nor
upper-key fences establish a coherent historical snapshot. COPY streams every
row, regardless of Data API caps, with deterministic C-collation ID/date ordering;
timestamp ties cannot skip rows. A concurrent commit after snapshot acquisition
is excluded consistently, not treated as zero or mixed into later pages. The
report is as-of that snapshot, not a claim that the live database is unchanged.

All sessions are scanned, including outside-range sessions needed for a
trustworthy old-timezone counterfactual and invalid/unlocatable rows. All daily
rows are scanned/fingerprinted; only in-range valid dates are reconciled. Two
full passes fingerprint each source table's entire stored rows with SHA-256;
counts must also match independently obtained snapshot counts. IDs, row count,
duration, all UTC timestamps, stored derived values and metadata are covered.
This checks preservation **inside the snapshot**; isolated tests additionally
compare independent whole-database before/after snapshots with no concurrent
writer. Read-only transaction enforcement independently disallows mutations.

Node processing is streaming (not an array of sessions) with backpressure. Maps
are bounded by a maximum explicit 3660-day range and 32 trusted old timezones.
A row over 2 MiB, unsafe integer aggregate, excessive range/timezones, query error,
transport failure, count/fingerprint mismatch or missing completion sentinel
rejects the report. There is a 120-second per-statement timeout, 30-second idle
transaction timeout and 10-minute process budget. None of these bounds returns a
truncated successful report. Partition an excessive range explicitly; each
partition has its own snapshot and must not be combined as if it shared one.
Postgres can spill ordered work to disk; the CLI introduces no server cursor,
snapshot table or durable repair state. Budget expiry kills the connection;
Postgres discards the read-only transaction. No source identifiers appear in the
JSON/summary; fingerprints are still private and must not be committed for real data.

## Reading the reconciliation

Daily rows include the union of existing/proposed valid dates, including missing
rollups, valid zero-duration days and old dates with no proposed sessions. Old,
new and delta reading duration/words/session counts are separate from stored
session words and their canonical per-session delta. A missing old rollup has
`old: null` and `delta: null`; monthly old totals explicitly sum **existing rows
only**, with missing counts and partial-month flags. Missing does not prove zero.

For a recognized old calendar method and valid recorded timezone, calculate:

1. Word-value/method difference = canonical words minus stored session words,
   both assigned to the recorded old calendar. Other two metrics have zero difference.
2. Timezone/day reassignment = target canonical aggregation minus canonical
   aggregation in the recorded old timezone.
3. Unexplained residual = stored-session aggregation in the old timezone minus
   persisted daily aggregation.

These sum to the total delta. They are counterfactual decompositions, not causal
proof of an old estimation formula. The old word method is not invented, even
when a session value matches. If old calendar provenance or a stored-word
baseline is unavailable, those explanations are NULL with an explicit reason;
only directly observable target-day session-value differences are calculated.
Monthly decompositions are available only when every day has a baseline.

Invalid IDs/durations/timestamps, unsafe word estimates and invalid daily metrics
are counted separately by reason. An invalid timestamp's calendar assignment is
unavailable; locatable invalid rows have affected-day counts. Invalid rows are
excluded from proposed **valid-row subtotals** and force
`complete_read_incomplete_reconciliation`. This is conservative even for invalid
rows outside the selected range. Invalid stored session words produce unavailable
baselines, never silently zero. A stale date means its reading aggregation is empty; it does not propose deleting the entire row or its unrelated article/highlight/source fields.

Report completeness describes stored input, not
Matter history coverage. No session-to-article attribution is inferred.

Committed [synthetic JSON](evidence/task19-synthetic.json) and
[summary](evidence/task19-synthetic.txt) show 675 words from three 60-second
sessions, 12 from three 1-second sessions, zero/unlinked, legacy/known/unknown,
Athens midnight/Monday/month/year and both DST changes, missing/stale days and
invalid historical rows. Larger streaming/failure fixtures are generated in tests.

## Validation and Task 20 handoff

Run all application gates and the unchanged guarded entry point:

```sh
npm ci
node node_modules/next/dist/bin/next typegen
npm run typecheck
npm run lint
npm run test
npm run build
npm run audit:ci
git diff --check
DISPOSABLE_DB_ACK=yes npm run test:stabilization-db
```

Both fresh and upgrade paths include `tests/integration/historical-preview.mjs`,
existing real Data API/browser denials and production page/ack/writer suites.
Both stacks also verify all 0–600-second normalizer outputs through real fenced
page commits, boundary false-tag rejection and independent word agreement for
all 5,000 continuation fixture rows.

Upgrade preserves every original column, explicitly excludes only the newly
added nullable fields from the old-schema comparison, and separately verifies
legacy provenance remains NULL. New metadata uses existing RLS/table grants and
existing exact RPC/helper security inventories. The preview suite checks more
than 10,000 tied sessions, independent whole-database preservation, repeatability,
actual source mutations during the snapshot, read-only enforcement, query errors,
writer metadata and false-version rejection. Unit transport failures/count checks
cover incomplete input without masking database errors. Data API caps cannot
limit COPY; existing low-cap query regressions remain part of `npm run test`.
A supplementary, Docker-socket-only PostgreSQL 17 gate is available when the full
Supabase images exceed environment capacity:

```sh
DISPOSABLE_DB_ACK=yes node scripts/task19-postgres-validation.mjs
```

It pins the image digest, creates owner-labelled fresh/upgrade containers without
published ports, synthesizes server/browser roles, applies the exact migration
chain, verifies catalog ACL/RLS/signatures and legacy-column preservation, runs
the real preview and executable CLI, and removes only its owned containers/volumes.
It records whether the worktree is dirty and retains sanitized results under the
tested SHA. It **does not** replace Supabase migration-history/Data API or browser
HTTP denial gates. No production URL or credentials are accepted.

See [validation evidence](task-19-validation.md) for exact tested commits/results.

Task 20 must consume the versions and source-snapshot contract, decide how to
handle invalid input/unavailable explanations, preserve raw fields and unrelated
rollup fields, and implement its own resumable repair, shadow recomputation,
catch-up, cutover and rollback with separately authorized production execution.
This preview has no repair activation or persistent work state. A successful
preview does not authorize a historical rewrite or prove a coherent live cutover.
