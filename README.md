# Matter Stats

Matter Stats is a private, single-user reading analytics dashboard for a Matter account. It uses the Next.js App Router, TypeScript, Tailwind CSS, Supabase, and a server-side Matter sync.

## Current Matter API limitation

- In the currently observed Matter reading session response shape, session records reliably include reading-time fields (timestamps and duration), but often do not include a linked item/article identifier.
- Because of that, `reading_sessions.item_id` is allowed to be null for imported sessions.
- Time-based analytics (reading time, session counts, daily trends, estimated words) remain reliable, while source/author/tag and article-level breakdowns can be partial until session-to-article metadata linking is available.

## Production-readiness notes

- Every app route except `/login` and static Next.js assets is protected by the `matter_stats_access` HTTP-only password cookie.
- Matter and Supabase service-role credentials are read only from server-side environment variables. Do **not** create `NEXT_PUBLIC_` copies of these secrets.
- The browser does not need a Supabase anon key for the current app. All reads, syncs, and diagnostics run through protected server components or server actions.
- Sync errors are stored and logged as sanitized status messages so failed Matter or database calls do not expose tokens or break dashboard rendering.
- Dashboard pages are rendered dynamically on Vercel, so the production build can complete without trying to connect to Matter or Supabase during static generation.

## Routes

- `/login` — private access form for the shared app password
- `/dashboard` — reading activity overview with manual Matter sync
- `/settings` — server-side Matter and Supabase sync diagnostics
- `/reports` — daily, weekly, monthly, and yearly summaries
- `/sources` — source analytics
- `/authors` — author insights
- `/tags` — tag trends
- `/articles` — searchable article library
- `/year-in-reading` — annual recap

## Environment variables

Create these values locally in `.env.local` and in Vercel project settings for Production:

```bash
APP_ACCESS_PASSWORD=use-a-long-password-manager-value
MATTER_API_TOKEN=your-matter-api-token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
MATTER_SYNC_ITEMS_LIMIT=25
MATTER_SYNC_SESSIONS_LIMIT=25
CRON_SECRET=generate-a-long-random-secret
```

The two `MATTER_SYNC_*_LIMIT` values are optional and default to `25`; keep them at `25` unless you intentionally want smaller sync pages.

Security rules:

- `APP_ACCESS_PASSWORD`, `MATTER_API_TOKEN`, and `SUPABASE_SERVICE_ROLE_KEY` are secrets. Never commit them and never prefix them with `NEXT_PUBLIC_`.
- `SUPABASE_SERVICE_ROLE_KEY` can bypass database access controls. Keep it in Vercel environment variables only.
- Rotate the Matter token or app password immediately if either value may have been exposed.

## Local development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000/login](http://localhost:3000/login), enter `APP_ACCESS_PASSWORD`, and then use the dashboard. If sync diagnostics show missing credentials, confirm `.env.local` contains the four variables above and restart the dev server.

## Deployment

For complete production setup instructions, see [Deployment guide: Vercel + Supabase](docs/deployment.md).

Short version:

1. Create a Supabase project.
2. Run the SQL files in `supabase/migrations` in timestamp order.
3. Add the server-side environment variables in Vercel, including `CRON_SECRET` for scheduled sync authorization.
4. Deploy with the default Next.js build command, `npm run build`.
5. In Vercel, configure a daily cron job (`0 6 * * *`) that calls `/api/cron/sync-recent-activity` and sends `Authorization: Bearer ${CRON_SECRET}`.
6. Open the Vercel URL from any PC, sign in at `/login` with `APP_ACCESS_PASSWORD`, and run **Sync Matter** from `/dashboard`.


## Scheduled sync on Vercel

- The server-only endpoint `/api/cron/sync-recent-activity` runs **recent-activity sync only** (no full-library backfill).
- The endpoint requires `CRON_SECRET` via either `Authorization: Bearer <secret>` or `?secret=<secret>`; unauthorized requests return HTTP 401.
- Keep `CRON_SECRET` in Vercel Environment Variables (Production) and never expose it client-side.
- Manual sync from `/dashboard` still works and remains available for on-demand imports.

## Checks

Run all production checks before pushing:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

The Vercel build should not require live Matter or Supabase network access during build time; those connections are checked at runtime after you sign in.
