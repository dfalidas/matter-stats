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

Set the server-only access password before running the app:

```bash
APP_ACCESS_PASSWORD=your-private-password
```

The password is checked only on the server and successful logins receive an HTTP-only secure cookie. Keep `MATTER_API_TOKEN` server-only and never expose it with a `NEXT_PUBLIC_` prefix.

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard) to view the placeholder dashboard.

## Checks

Run ESLint:

```bash
npm run lint
```

Run the TypeScript compiler without emitting files:

```bash
npm run typecheck
```
