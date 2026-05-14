# Matter Stats

Matter Stats is a private, single-user reading analytics dashboard scaffolded with the Next.js App Router, TypeScript, Tailwind CSS, and ESLint.

## Routes

- `/login` — private access form for the shared app password
- `/dashboard` — placeholder analytics overview
- `/settings` — placeholder dashboard settings
- `/reports` — placeholder reading reports
- `/sources` — placeholder source analytics
- `/authors` — placeholder author insights
- `/tags` — placeholder tag trends
- `/articles` — placeholder article library
- `/year-in-reading` — placeholder annual recap

## Getting started

Set the required environment variables before running the app:

```bash
APP_ACCESS_PASSWORD=your-private-password
MATTER_API_TOKEN=your-matter-api-token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-browser-safe-anon-key
```

The password is checked only on the server and successful logins receive an HTTP-only secure cookie. Keep `MATTER_API_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` server-only and never expose either value with a `NEXT_PUBLIC_` prefix. Client components should use the anon-key browser client in `lib/supabase.ts`, while server actions and sync jobs should use the service-role admin helpers in `lib/supabase-admin.ts`.

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard) to view the placeholder dashboard.

## Deployment

For production setup instructions, see [Deployment guide: Vercel + Supabase](docs/deployment.md).

## Checks

Run ESLint:

```bash
npm run lint
```

Run the TypeScript compiler without emitting files:

```bash
npm run typecheck
```
