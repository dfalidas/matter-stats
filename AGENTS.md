# Matter Stats contributor guide

This file applies to the whole repository. Matter Stats is a private, single-user Next.js application; preserve that security model when making changes.

## Start here

- Read `docs/architecture.md` before changing synchronization, persistence, or metric calculations.
- Use Node.js 20 or newer. In a fresh Codex Cloud checkout, run `npm ci` (not `npm install`) so `package-lock.json` remains authoritative.
- Copy `.env.example` to `.env.local` only when runtime integration work is needed. Never commit `.env.local`, tokens, passwords, service-role keys, or real project URLs.
- The application uses the `@/` path alias. Keep data access in server components/services and interactive presentation in client components.
- `lib/matter-api.ts`, `lib/matter-sync.ts`, `lib/supabase-admin.ts`, and `lib/env.ts` are server-only boundaries. Do not import them into files marked `"use client"`.

## Development workflow

```bash
npm ci
npm run dev
```

The local app is at `http://localhost:3000`. Live pages and synchronization require the server-only values documented in `.env.example`; compilation and the unit tests do not.

Before committing, run the same repository checks expected in Codex Cloud/CI:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Tests are Node's built-in test runner. `npm test` first compiles the isolated test project into `.test-build/`, then executes `node --test .test-build/tests/*.test.js`. Add focused tests under `tests/` for changes to normalizers, synchronization state, metrics, rankings, or reports.

## Architecture and implementation rules

- App Router pages live in `app/`. They are dynamically rendered where they query Supabase. Prefer server components for reads and narrowly scoped client components for filters and interaction.
- Database reads and feature aggregation belong in `lib/*-service.ts`; privileged writes belong in `lib/supabase-admin.ts`.
- Treat Matter payloads as untrusted external input. Normalize them in `lib/matter-normalizers.ts` and keep API error messages/token handling sanitized.
- Keep synchronization idempotent: stable Matter IDs are upsert keys, `item_tags` uses its composite key, and checkpoints/cursors advance only after a successful batch.
- A reading session may legitimately have a null `item_id`. Time/session metrics remain usable, but item, source, author, and tag breakdowns can be incomplete. Do not silently discard such sessions.
- Metric periods use half-open ranges (`start <= started_at < end`) and `APP_TIMEZONE` (default `Europe/London`). Preserve timezone and daylight-saving behavior and add tests around boundary changes.
- Keep all secrets server-only. Never add a `NEXT_PUBLIC_` alias for Matter, Supabase admin, app-password, or cron credentials.

## Database safety

- Migration files in `supabase/migrations/` are append-only and timestamp ordered. Update `lib/supabase-types.ts` with schema changes.
- **Never run migrations, `supabase db push`, destructive SQL, or synchronization against a production Supabase project from an agent/Codex task.** Preparing and statically reviewing a migration is allowed; applying it requires an explicitly selected non-production project or a human-controlled production release.
- Do not invoke manual or scheduled Matter sync merely to validate code. It mutates Supabase and consumes an external API. Unit-test the pure/dependency-injected paths instead.

## What requires external access

- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` are local checks after dependencies are installed.
- End-to-end login needs `APP_ACCESS_PASSWORD`; live sync needs Matter and Supabase credentials; the cron route additionally needs `CRON_SECRET`.
- Verifying imported rows, API response compatibility, rate-limit behavior, Vercel schedules, and deployed pages requires authorized Matter, Supabase, and/or Vercel access and must be reported separately from local checks.
