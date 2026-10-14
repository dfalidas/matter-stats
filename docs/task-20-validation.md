# Task 20 validation

Base: `739cade8e0366963fe2f7332b5b78516e01f9125` (latest origin/main inspected 2026-10-14; no later changes). The implementation is limited to synthetic isolated databases. See [operator guide](task-20-operator-guide.md) for mechanism, scope, reader/writer inventory, migration/application order and rollback compatibility.

Development verification has exercised the actual SQL migration and engine in a digest-pinned PostgreSQL 17 disposable container, including durable capture, Task 19 reconciliation, 10,000+ tied sessions, all 0–600 durations, failure before commit, process termination after commit, lease takeover, catch-up/date changes, transactional cutover coordination, preserved source/metadata, reversible rollback and unchanged-input no-op. This supplemental runner explicitly reports `realSqlAndDataApi=false`; it is **not** Supabase acceptance evidence.

Exact clean implementation/final SHAs, command results, full fresh/upgrade Supabase outcomes and GitHub CI reconciliation are recorded below after execution. Pending verification is not release readiness. No production SQL, Matter sync, deployment/promotion, cutover, rollback or merge has been executed.
