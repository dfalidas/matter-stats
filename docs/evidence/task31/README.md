# Task 31 current-baseline synthetic inspection

All images here are **before / unchanged baseline**, not before/after pairs.
Executable source: `2054aa821f399b4c3073e4147fb78c49a4631352`.
No real user data or production credentials are used. `inspection.json` is
browser inspection, not real usage or physical iPhone evidence.

Reproduce from repository root with Node 22.x and the lockfile:

1. `npm ci`, `npx --no-install next typegen`, `npm run test`, `npm run build`.
   For build/runtime use `sanitizedEnvironment` from
   `scripts/database-evidence.mjs`; do not inherit real app credentials or load
   a production `.env.local`.
2. `npx --no-install playwright install chromium webkit`; install host libraries
   where permitted. The recorded Linux host could run Chromium, but not WebKit.
3. Copy `scripts/task22-ui-fixture.mjs` to `work/task31/fixture.mjs`. Adjust both
   `.test-build` require paths from `../.test-build/` to `../../.test-build/`.
   Inside `tables()` add the following synthetic table (no persistent storage):

   ```js
   reading_goals: ["weekly", "yearly"].map(type => ({
     type,
     period_start: require("../../.test-build/lib/reading-goals.js")
       .currentGoalPeriod(type, now).start,
     target_seconds: type === "weekly" ? 7200 : 72000,
     enabled: true,
   })),
   ```

4. Spawn that fixture and `node node_modules/next/dist/bin/next start -H 127.0.0.1
   -p 3091` with `sanitizedEnvironment` and these overrides:
   `SUPABASE_URL=http://127.0.0.1:54391`, `SUPABASE_SERVICE_ROLE_KEY=synthetic-only`,
   `APP_ACCESS_PASSWORD=synthetic-only`, `APP_CREDENTIAL_VERSION=1`,
   `MATTER_API_TOKEN=synthetic-unused`, `CRON_SECRET=synthetic-unused`,
   `APP_TIMEZONE=Europe/Athens`, `NEXT_TELEMETRY_DISABLED=1`.
5. Copy `inspect.mjs.txt` into `work/task31/inspect.mjs`, then run it from root.
   It uses the fixture's fixed synthetic session cookie, blocks external browser
   requests, reads actual production-built pages and never presses ingestion or
   goal submission buttons. Account menu, goal Edit/Close and Reports Apply use
   actual UI controls. The fixture refuses domain mutations.
6. Stop both owned children after inspection; retain sanitized JSON/images only.

Filename: engine–viewport width–theme–flow. Goals and review captures show complete section elements; entry captures show
the viewport at page entry and sync captures scroll to the existing controls. Theme is the app's actual `dark`
root class, set explicitly after hydration as well as browser color preference.
The 320×844 and 390×844 contexts use touch/mobile flags; 1440×1000 is desktop.
This is Chromium on Linux, not an iPhone device or Safari. Synthetic dates/clock
are generated at launch, so later captures may differ in current-period values.
