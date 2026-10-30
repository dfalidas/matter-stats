# Deployment reference

Start with the [current release and recovery runbook](security-release-runbook.md).
It owns preflight, exact candidate/check identities, migration-before-code order,
reader/writer drain, Free-plan backup/restore, compatibility and the three rollback
choices. Its checklist replaces the historical per-task deployment sequences.

Configuration names match [.env.example](../.env.example); all remain server-only.
Use CI's Node 22 toolchain and exact `npm ci` lockfile. Local verification:

`package.json` pins the deployment Node major with `engines.node: "22.x"`.
On Vercel, this field overrides the project's Node.js Version setting. The runtime
change takes effect on a **new deployment**; editing the repository does not change
an existing deployment. Keep the existing CI action, browser and database toolchain
pins unchanged. After review and merge, verify the new production deployment's
commit and READY status, Node.js 22.x for dashboard, settings and
`/api/cron/sync-recent-activity`, and each function's Max Duration ≤180s.
Operator evidence received 2026-10-30 showed Node.js 24.x and displayed Max Duration
≤180s for all three; it describes the prior deployed runtime, not a Node 22 rollout.

`USE_MOCK_MATTER_API` has no reader or reference in the tracked application,
scripts, configuration or environment template at the reviewed baseline
`ed5a4f2`. Dashboard actions and the scheduled cron call `syncMatterData` in
`lib/matter-sync.ts`, which uses `lib/matter-api.ts`: requests target
`https://api.getmatter.com/public/v1` and authenticate with the server-only
`MATTER_API_TOKEN` read by `lib/env.ts`. There is no environment-driven mock branch.
Consequently, setting `USE_MOCK_MATTER_API` cannot switch ingestion to mocks in
this code. Its production value was not retrieved and need not be changed for
this runtime alignment. Confirm the deployed commit before applying this source
finding to a running deployment; an older deployment may contain different code.

Run the existing checks under Node 22 (the recorded tested toolchain is
Node 22.23.3/npm 10.9.9):

```sh
npm ci
npx --no-install next typegen
npm run typecheck
npm run lint
npm run test
npm run build
npm run audit:ci
DISPOSABLE_DB_ACK=yes npm run test:stabilization-db
```

The final command requires Docker and runner-owned disposable Supabase; it includes
fresh/upgrade preservation, security and the synthetic restore rehearsal. Unavailable
execution is a blocker. Do not point it at staging/production or substitute plain
PostgreSQL. `test:security-db` alone is not the complete database gate.

Apply the **entire outstanding migration chain in timestamp order**, ending at
`20261015141435_truthful_sync_status.sql`, only during a separately authorized release.
[Compatibility and release order](security-release-runbook.md#release-order) explain
why retained additive schema does not make old writers/readers safe.

Specialist references:

- [Task 19 read-only preview and dedicated connection isolation](task-19-preview.md).
- [Task 20 generation readers, bounded repair lifecycle and fenced rollback](task-20-operator-guide.md).
- [Task 21 status definitions, freshness, invocation correlation and uncertainty](task-21-status.md).
- [Task 22 route/UI validation and historical audit discrepancy](task-22-qa.md).
- [Task 23 requirements, verification and unresolved gates](task-23-validation.md).
- [Task 24 isolated full-stack matrix and release gates](task-24-validation.md).
- [Task 24 execution and actual hosted-staging prerequisites](task-24-execution-guide.md).

Keep `vercel.json`'s daily **`0 6 * * *` UTC** cron and exact Bearer `CRON_SECRET`.
Manual actions use the opaque database session guard. Partial bounded synchronization
retains checkpoints and continuation; no reset or historical completeness claim is
part of release. Task 24 owns separate staging end-to-end verification. Production
schema/configuration/backup state, authorized repair/cutover and two real scheduled
cycles remain external gates. No deployment, production SQL, real sync or merge is
performed by these instructions alone.

<a id="task-13-release-order-and-rollback"></a>

Historical links to the Task 13 sequence now resolve here. Use the consolidated
[release order](security-release-runbook.md#release-order) and
[rollback decision](security-release-runbook.md#rollback-decision-and-sequence),
which include all later quota, provenance, generation and status requirements.
