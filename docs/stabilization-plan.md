# Matter Stats — Σχέδιο υλοποίησης για το Sol

**Έκδοση 1.1 · 29/09/2026 · Βάση: Matter Stats Review 28/09/2026 και έλεγχος επίσημης τεκμηρίωσης Matter API v1 στις 29/09/2026.**

Η 1.1 αντικαθιστά πλήρως την 1.0. Είναι σχέδιο υλοποίησης και όχι αναφορά εκτελεσμένων αλλαγών. Ο upstream έλεγχος αφορά τεκμηρίωση και όχι live contract test λογαριασμού.

## 1. Εντολή, αποτέλεσμα και όρια

Σταθεροποίηση, όχι επανεγγραφή. Διατηρούνται Next.js, TypeScript, Supabase, Vercel, το interface και η προσωπική/single-user χρήση. Στόχος είναι ασφαλής πρόσβαση, αξιόπιστη αυτόματη εισαγωγή, ελέγξιμα analytics και σαφής ένδειξη πληρότητας/freshness.

Αφετηρία review: `bd4966c95d56132d9dfbcd213714f2225c8ac89f` (`main`, 16/07/2026). Κάθε εύρημα επαληθεύεται στο πραγματικό HEAD· δεν επαναφέρεται παλιός κώδικας.

Επιτρέπονται τοπικός κώδικας, migrations ως αρχεία, tests, docs και commits. Δεν επιτρέπονται push/merge, production deploy/migration/recompute/mutation, αλλαγή secrets, paid cron/provider ή μη εγκεκριμένη αρχιτεκτονική. Δεν χρησιμοποιείται production DB για mutation tests και preview→production δεν θεωρείται staging. Δεν καταγράφονται tokens, passwords, cookies, raw προσωπικά payloads ή service-role credentials. Χωρίς πρόσβαση, παραδίδεται runbook και το production εύρημα μένει μη επαληθευμένο.

Εκτός scope: native apps, knowledge graph, AI summaries, άσχετα dashboards/redesign, multi-user auth, hosting migration, πιθανοτική session→article σύνδεση και το χωριστό Matter API/MCP plugin.

## 2. Ευρήματα

| ID | Εύρημα | Αρχικός περιορισμός |
|---|---|---|
| R1 | Απουσία RLS hardening | Live policies/grants απαιτούν σημερινό έλεγχο |
| R2 | Next.js 15.5.18 στο lock | Απαιτούνται σημερινά official advisories |
| R3 | Μία σελίδα sessions/run, default 25, ετήσιο restart | Επιβεβαίωση στη ροή |
| R4 | Shared state, mode reset, χωρίς lease | Incident παραγωγής δεν αποδείχθηκε |
| R5 | Analytics χωρίς pagination | Live Supabase cap άγνωστο |
| R6 | Current streak από τέλος περιόδου | Αναπαραγώγιμο |
| R7 | `word_count×progress` ανά session | Αναπαραγώγιμο |
| R8 | London metrics, UTC rollups/reports | Ασυνεπές |
| R9 | Στατικό cookie χωρίς server expiry/revocation/limiter | External Vercel rules άγνωστοι |
| R10 | Integration gaps, μεγάλο sync module, διπλά queries, παλιές οδηγίες | Επιβεβαίωση στο HEAD |

Production counts, last complete sync και πραγματική linkage coverage είναι άγνωστα. Ιστορικά δείγματα δεν είναι baseline.

## 3. Σειρά και gates

| Πακέτο | Παραδοτέο | Εξάρτηση | Gate |
|---|---|---|---|
| W0 | Baseline, contract, fixtures | — | HEAD/capabilities/gaps καταγεγραμμένα |
| W1 | RLS/minimum privileges | W0 | Data API denial και service-role allowance σε test DB |
| W2 | Dependency security baseline | W0 | Τεκμηριωμένο patched target και πράσινα checks |
| W3 | Sessions, limiter, guards | W1–W2 | Expiry/revocation/concurrency/auth tests |
| W4 | Sync state/leases/continuation | W1–W2 | Resume/concurrency/fault tests |
| W5 | Complete queries/metric contract | W0, W1 για RPC | Large-data/timezone tests |
| W6 | Reversible historical recompute | W4–W5 | Dry-run/reconciliation, raw invariants |
| W7 | Monitoring/coverage UX/docs/CI | προηγούμενα tests | Truthful data state and automatic gates |
| W8 | Staging/controlled release | release scope | Deploy/rollback evidence |
| W9 | Optional metadata extensions | μετά σταθεροποίηση | Νέα εγκεκριμένη πρόταση |

Release 1: W1–W3 και αντίστοιχο W8. Release 2: W4–W7 και πλήρες W8. Το RLS patch δεν περιμένει analytics.

## 4. W0 — Baseline, πρόσβαση, reproducibility

1. Έλεγχος AGENTS/project instructions, branch, HEAD, dirty state, migrations, lockfile, scripts και tests.
2. Σύγκριση με reviewed commit και τεκμήριο για κάθε ήδη διορθωμένο εύρημα.
3. Εκτέλεση υπαρχόντων checks χωρίς αλλαγή tests για τεχνητό πράσινο.
4. Synthetic characterization/target fixtures R3–R8. Τα characterization tests περνούν αποτυπώνοντας το σημερινό bug. Τα target tests επισημαίνονται ρητά `todo/skip` μέχρι W4/W5 και δεν δημιουργούν κόκκινο CI.
5. Read-only audit schema/RLS/policies/grants, session count, min/max timestamps, duration, null-link ratio, latest run και cursors, μόνο με ήδη εγκεκριμένη πρόσβαση.
6. Κατηγορίες «έγινε», «δεν ελέγχθηκε», «blocked από πρόσβαση» και έλεγχος production deployment↔main.

### 4.1 Matter API contract

Base `https://api.getmatter.com/public/v1/`, server Bearer, Matter Pro. Unknown response fields αγνοούνται, required fields επικυρώνονται.

| Endpoint | Contract | Χρήση |
|---|---|---|
| `GET /reading_sessions` | `id,date,seconds_read,object`; inclusive `since`, `limit,cursor`; descending | time/sessions/days/streaks |
| `GET /items` | `updated_since,status,order,limit,cursor` | bootstrap/incremental metadata |
| `GET /items/{id}` | metadata/progress/nullable estimated word count, optional markdown | library detail, όχι actual session time |
| `GET /items/{id}/annotations` | per-item pagination | optional annotations, χωρίς assumed updated_since |
| `GET /tags` | pagination | tag catalogue, χωρίς assumed updated_since |

Envelope `results,has_more,next_cursor`, limit 1–100/default 25. Adapter: `date→occurred_at`, `seconds_read→duration_seconds`, `id→external_session_id`; legacy `started_at` είναι alias occurrence. UTC δεν αλλάζει και δεν επινοείται `ended_at`. Το `object` είναι discriminator. Δεν τεκμηριώνονται item link, measured words, session until/order/updated_since, retention, cursor TTL ή late-arrival bound. Missing link είναι κανονική δυνατότητα, όχι enrichment retry. Legacy links απαιτούν provenance.

Παραδοτέα: baseline, API contract με documented/observed/policy/unavailable, tracking R1–R10, synthetic fixtures και audit SQL.

## 5. W1 — RLS και ελάχιστα δικαιώματα

Inventory όλων των app-owned tables/views/functions. Νέο additive migration, ποτέ rewrite εφαρμοσμένου migration. RLS σε exposed tables χωρίς `USING(true)`. Object-scoped revoke από `PUBLIC/anon/authenticated`, όχι schema-wide collateral change. Έλεγχος views/RPC execute/`SECURITY DEFINER`; invoker όπου αρκεί, αλλιώς fixed safe `search_path`, qualified objects και explicit callers. Ίδια προστασία για μελλοντικά auth/lease/metrics objects. Service role παραμένει server-only.

Σε disposable DB, fresh chain και upgrade chain. Μέσω πραγματικού Data API: SELECT/INSERT/UPDATE/DELETE ως anon και unauthorized authenticated· ελέγχεται αποτέλεσμα/row effect, όχι μόνο HTTP status. Ελέγχονται RPCs/views και προβλεπόμενες service-role πράξεις. Χωρίς αυτή την εκτέλεση: **W1 unverified, not release-ready**. Production verification απαιτεί έγκριση, read-only grants/policies και Security Advisor.

## 6. W2 — Dependencies

Χρήση installed/locked versions, official current Next.js/React advisories και supported branches. Επιλέγεται η μικρότερη ασφαλής supported αναβάθμιση· major μόνο με αιτιολόγηση/έγκριση. Ενημερώνονται lock και συμβατά packages, ποτέ blind `npm audit fix --force`. Καταγράφονται advisory applicability και residual risks.

Gate: reproducible `npm ci`, audit, typecheck, lint, tests, build, login/cron smoke, secret scan. Registry/advisory failure καταγράφεται ακριβώς και κρατά W2 ανοιχτό· δεν μαντεύεται έκδοση.

## 7. W3 — Authentication/access boundaries

Single-user password UX. Random opaque cookie, μόνο token hash στη DB, `created_at/expires_at/revoked_at`, credential version. Server TTL 30 ημερών. Logout ανακαλεί συγκεκριμένο session· credential version rotation όλα τα παλιά. Cookie HttpOnly, production Secure, SameSite, path `/`, ποτέ URL token.

Ο limiter είναι shared και bounded ανά trusted client identifier, με atomic database decision+record ώστε concurrent instances να μην ξεπερνούν το όριο. Όχι process Map ή global account lockout. Καταγράφονται trusted-IP source, threshold και cooldown. Κάθε function έχει explicit execute grants.

Auth σε protected reads, actions και handlers. Middleware μόνο early redirect. Explicit static/public allowlist. Cron αποκλειστικά Bearer `CRON_SECRET`. Storage failure fail-closed. App session, cron secret και Matter token είναι διαφορετικά· Matter token δεν αναγεννάται εδώ.

Tests: correct/wrong password, δύο/concurrent instances, malformed/expired/revoked/replayed token, credential rotation, anonymous action/data access, dynamic article/dotted paths, cron missing/wrong/correct secret και data-layer bypass attempt.

## 8. W4 — Αξιόπιστος συγχρονισμός (deferred)

### Streams/checkpoints

Ανεξάρτητα `recent_sessions` και `library_items`; library backfill είναι phase, όχι replacement. Sessions με documented `since`; items initial enumeration μετά `updated_since,status=all,order=updated`. Annotations/tags endpoint-specific. Trigger manual/scheduled δεν αλλάζει stream/cursor. Persist endpoint, fixed lower bound/filters/limit, cycle start, generation και opaque cursor. Window change γίνεται explicit backfill/restart, ποτέ cursor με άλλα φίλτρα.

### Incremental semantics

Cursor δεν θεωρείται immutable snapshot και δεν στέλνεται undocumented upper bound. Νέος cycle από completed watermark με 7-day configurable overlap (app policy). Partial DB χρειάζεται explicit coverage start/reconciliation. Candidate watermark είναι cycle start και προωθείται μόνο σε exhaustion. Inclusive sessions/exclusive item updates αντιμετωπίζονται με overlap/idempotency χωρίς +1ms. Invalid cursor κάνει bounded restart μόνο για αναγνωρισμένο cursor error. Χωρίς deletion feed δεν διαγράφεται metadata από απουσία. Activity timestamps δεν συγχέονται με sync completion και year boundary δεν ακυρώνει cycle.

### Budgets/rates/failure safety

Πολλές σελίδες μέχρι page/request/time budget, page limit ≤100, termination από `has_more`. Shared account limiter 120 GET/min, burst 5/sec, markdown 20/min και μέσα στο GET quota. Διαβάζονται limit/remaining/reset/retry headers. Request timeout και runtime margin, χωρίς long sleeps/fire-and-forget. Budget exhaustion γράφει durable partial cursor. Διατηρείται αρχικά 06:00 UTC.

Atomic DB lease ανά Matter account με owner, expiry, monotonic fencing generation και heartbeat/renewal. Κάθε checkpoint/write ελέγχει ownership· stale worker δεν γράφει/ξεκλειδώνει. Δεν κρατιέται SQL transaction σε network call. Page rows+checkpoint+dirty rollup marker είναι bounded atomic commit. Stable session-id upsert, nullable item link, bounded sanitized quarantine. 429 persistent retry time, transient bounded jitter, 401/403 visible no-loop, 400/422 validation no checkpoint. Missing/repeated cursor με `has_more` είναι protocol error.

Statuses: running/completed/partial/skipped_locked/skipped_rate_limited/failed. Counters fetched/inserted/updated/unchanged/invalid/unlinked/requests. Partial/skip δεν ενημερώνει last complete.

Acceptance: 5,000 sessions across invocations, minimal payload, boundaries/ties/late arrivals, independent streams, exact resumed filters, shared rates, idempotency, manual↔scheduled continuity, concurrent/stale workers, crash points, 429/timeout/5xx/401/malformed/repeated cursor, overlap/reconciliation/year/null links και successful empty cycle.

## 9. W5 — Πλήρη analytics και metric contract (deferred)

Όλα τα metrics/reports/source/author/tag/article/daily/query paths ελέγχονται για Supabase cap. Totals/rankings με DB aggregation/indexes· raw collection με deterministic pagination (`occurred_at+id` ή legacy `started_at+id`) και safe page size, όχι short-page assumption. UI page δεν παράγει totals. Embedded relations/facets/large `in()` δεν truncation. Common generation/as-of για consistency. Νέα RPCs περνούν W1. Request-scoped dedupe, όχι global private cache.

| Metric | Definition |
|---|---|
| Total time | sum valid non-negative duration, independent of link |
| Sessions | distinct valid external IDs; zero kept but not active day |
| Active day | local day total >0 |
| Current streak | today; if empty today, ending yesterday; else 0 |
| Historical streak | explicit “as of date” |
| Articles engaged/completed | unavailable without documented link/completion event |
| Estimated session words | per-session `round(seconds/60×225)`, then sum, labeled/versioned estimate |
| Library words | distinct item known nullable estimated count with coverage |
| Source/author | library metadata counts; no reading attribution without provenance |
| Tags | overlapping library counts, not shares forced to 100% |

Archive/extraction/progress do not prove dated completion. Availability/data quality are separate from value; unavailable/incomplete/zero differ.

Canonical `APP_TIMEZONE=Europe/Athens`; UTC stored raw. Shared helpers, Monday–Sunday, `[start,end)`. Entire session duration belongs to local occurrence date; no invented interval/midnight split. DST/month/year tests. Live period-to-date compares equivalent elapsed prior portion; historical reports compare full periods.

Acceptance includes 1,200×60 sec = 72,000, >10k rows/low cap/ties, null/overlapping metadata, unlinked duration/streak, 26–28/09 streak=3, yesterday carry/zero, three 60-sec sessions=675 estimated words not 3,000, Athens midnight/week/DST/year and independent reference aggregation.

## 10. W6 — Reversible recomputation (deferred)

Derived version/method/provenance, source values separate. Dry-run resumable bounded batches for legacy estimates/rollups only. Old/new daily/monthly reconciliation explaining timezone/method deltas. Shadow/versioned cutover preferred; no mixed versions. Remove stale emptied dates. Protect against sync or use snapshot/generation catch-up. Production requires approved backup, restore plan and explicit permission.

Invariants: raw session count/IDs, total duration and UTC timestamps unchanged; rerun idempotent. Deliver dry-run/execution commands, reconciliation and rollback.

## 11. W7 — Monitoring, UX, CI (deferred)

Show last attempted, last completed data sync, analytics-ready version/time, newest imported activity separately, active/partial/backlog/retry/lock state, and coverage only for completed API checks. Min/max is not proof of history. Session metadata attribution is “unavailable” under documented contract, not failed/zero. Unknown backlog stays unknown. Distinguish no reading, not synced, partial, metadata unavailable, upstream failure.

Daily policy: warning after 36h without completed cycle; empty completed cycle counts, partial/skip does not. First in-app/sanitized logs; external alert only approved channel.

CI: lockfile install, typecheck, lint, unit/integration/build, isolated DB with no production secrets/untrusted-fork access. Behavior tests for auth/cron/pagination/correctness. Update README/deployment/QA/metadata docs with migration order, env, timezone, cron Bearer, limitations/recovery. No cosmetic/general REST refactor.

## 12. W8 — Release verification (deferred)

Gate A: green checks, reviewed diff/residual risks; fresh+upgrade migrations; rolling compatibility; exact backup→migration→env→app→backfill/recompute→verify order; code+data rollback, never routine RLS disable.

Gate B staging: isolated synthetic/sanitized DB; login→dashboard→manual sync→reports→logout; cron authorize/reject; pagination/429/timeout/double run/interruption; independent reconciliation; desktop/mobile affected UI.

Gate C production only after approval: exact commit/migrations/times, read-only auth/RLS/count/metric validation, one controlled sync only if authorized, then two real scheduled cycles. Status remains “deployed, awaiting scheduled verification” until evidence. Completion requires denied unauthorized access, reconciled data, real logs, visible freshness and no unexplained delta.

## 13. W9 — Optional metadata (deferred)

Later separate proposal only for documented library composition, status/favorite/tag filters, item detail and independently paginated annotations. Each records source fields, endpoint, freshness/nulls/request budget/acceptance. New official session link requires schema/tests; observed field alone is insufficient. No inferred/AI/time-based links or authoritative overwrite. New cost/scope requires approval.

## 14. Final matrix / reporting

Required evidence: RLS/RPC denied anon/unauthorized and allowed server; auth expiry/logout/version/concurrent limiter/direct access; cron 401/correct stream/status; sync filters/pages/checkpoints/rates/idempotency/resume/lease/faults; queries >1k/>10k/low-cap/ties; metrics streak/words/null/unavailable/timezone; recompute dry-run/resume/version/raw invariants; UX missing≠zero; CI/runbooks.

Κάθε package αναφέρει αλλαγές/R IDs/αρχεία, ακριβή tests, migrations/env/operations, data impact/rollback και εκκρεμή evidence. Τελική κατάσταση ανά R: verified fixed / code ready production pending / blocked / deferred. Δεν χρησιμοποιείται γενικό «ολοκληρώθηκε» με production ή scheduled evidence σε εκκρεμότητα.

## 15. Πρώτη εντολή

Πρώτα W0 και contract, μετά ασφαλείς τοπικές W1–W3 σύμφωνα με dependencies. Δεν σταματά η εργασία για naming/internal structure· σταματά μόνο για access, κόστος, scope ή production action. Επιτυχία είναι προστατευμένα δεδομένα, εισαγωγή χωρίς απώλεια και ανεξάρτητα ελέγξιμοι αριθμοί.

## 16. Επίσημες πηγές και policy boundary

[S1 overview](https://docs.getmatter.com/api), [S2 sessions](https://docs.getmatter.com/api/reading-sessions/list), [S3 items](https://docs.getmatter.com/api/items/list), [S4 item](https://docs.getmatter.com/api/items/get), [S5 update](https://docs.getmatter.com/api/items/update), [S6 pagination](https://docs.getmatter.com/api/pagination), [S7 limits](https://docs.getmatter.com/api/rate-limits), [S8 authentication](https://docs.getmatter.com/api/authentication), [S9 errors](https://docs.getmatter.com/api/errors), [S10 versioning](https://docs.getmatter.com/api/versioning), [S11 annotations](https://docs.getmatter.com/api/annotations/list), [S12 tags](https://docs.getmatter.com/api/tags/list).

225 WPM, overlap 7 ημερών, Europe/Athens, cookie TTL 30 ημερών και stale threshold 36 ωρών είναι application policies, όχι Matter guarantees.
