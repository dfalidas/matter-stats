# Deployment reference

Start with the [current release and recovery runbook](security-release-runbook.md).
It owns preflight, exact candidate/check identities, migration-before-code order,
reader/writer drain, Free-plan backup/restore, compatibility and the three rollback
choices. Its checklist replaces the historical per-task deployment sequences.

Configuration names match [.env.example](../.env.example); all remain server-only.
Use CI's Node 22 toolchain and exact `npm ci` lockfile. Local verification:

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

Keep `vercel.json`'s daily **`0 6 * * *` UTC** cron and exact Bearer `CRON_SECRET`.
Manual actions use the opaque database session guard. Partial bounded synchronization
retains checkpoints and continuation; no reset or historical completeness claim is
part of release. Task 24 owns separate staging end-to-end verification. Production
schema/configuration/backup state, authorized repair/cutover and two real scheduled
cycles remain external gates. No deployment, production SQL, real sync or merge is
performed by these instructions alone.
