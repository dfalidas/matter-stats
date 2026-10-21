# Task 24 evidence

This bundle separates **A** application/synthetic coverage, **B** production Next
plus real local Supabase, **C** actual hosted staging and **D** production/scheduled
delivery. C is BLOCKED/NOT RUN and D NOT RUN. B runs on runner-owned local Docker,
including when that runner is GitHub-hosted; this is not a hosted staging database.

- [Validation and requirements matrix](../../task-24-validation.md).
- [Reproduction and hosted operator prerequisites](../../task-24-execution-guide.md).
- [Application CI](application-ci.json) and [local application commands](local-validation.json):
  403 application tests, distinct from browser/database phase counts.
- [Completed B checkpoint](verified-69fdc63/): source/build/harness/checkout
  `69fdc63b69383efbb064a6ee92b7edba657e16e1`, 32 browser behavioral groups,
  7 database phase groups and 13 overall harness phases. Original JSON is unchanged.
- [Visual inspection](visual-inspection.json): all seven PNGs inspected separately
  from the original harness's initially-pending screenshot manifest.
- [Artifact provenance and verified ZIP digests](provenance.json).
- [Separate Task 23 database gate](database-69fdc63/): 29/29 phase groups,
  nested synthetic backup/restore 10/10, 26 tables reconciled, verified owned cleanup.
- [Recovery failure at 160ed48](recovery-160ed48/),
  [final-console failure at 8c1675d](recovery-8c1675d/),
  [blocked local provisioning](local-provisioning-blocked/) and
  [attempt history/cleanup limitations](attempt-history.json) retain original identities.

The allowlist contains named structured identity, outcome, fixture, toolchain,
migration, browser/network, cleanup and assertion records, plus seven inspected
screenshots. No environment, credentials, cookie/hash, storageState, raw log,
HAR/trace, personal data or database dump is included. The synthetic restore gate
retains only verification metadata; its dump is never an artifact.

The immutable code checkpoint is preserved even after documentation-only commits.
Final candidate SHA and exact-head CI/artifact links are in draft
[PR #87](https://github.com/dfalidas/matter-stats/pull/87). A final check failure or
unavailable external prerequisite must remain unresolved; an older pass does not
certify changed implementation. No branch-protection configuration is claimed.
