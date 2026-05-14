# Deployment guide: Vercel + Supabase

This guide walks through deploying Matter Stats with a hosted Supabase database and Vercel. It assumes you have:

- A GitHub account with this repository pushed to GitHub.
- A Vercel account connected to GitHub.
- A Supabase account.
- A Matter API token for the Matter account you want to sync.

## 1. Create a Supabase project

1. Sign in to the [Supabase dashboard](https://supabase.com/dashboard).
2. Select **New project**.
3. Choose an organization, enter a project name such as `matter-stats`, and create a strong database password.
4. Pick the region closest to where you usually use the app.
5. Select **Create new project** and wait for Supabase to finish provisioning the project.
6. Open **Project Settings** > **Data API** or **API Keys** and copy these values for the Vercel setup later:
   - **Project URL**: used for `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`.
   - **anon** or **publishable** browser-safe key: used for `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - **service_role** or **secret** server key: used for `SUPABASE_SERVICE_ROLE_KEY`.

> Keep the service-role or secret key private. It can bypass normal database access controls and must never be committed to GitHub or exposed with a `NEXT_PUBLIC_` prefix.

## 2. Run the SQL migrations

The app needs the tables, indexes, functions, and schema changes in `supabase/migrations` before the first Vercel deployment can work.

### Option A: Supabase SQL Editor (easiest)

1. In the Supabase dashboard, open your project.
2. Go to **SQL Editor**.
3. Select **New query**.
4. Open `supabase/migrations/20260513000000_create_matter_stats_mvp_schema.sql` from this repository, copy the full file contents, paste them into the SQL editor, and select **Run**.
5. Create another new query.
6. Open `supabase/migrations/20260514000000_add_sync_run_annotation_tag_counts.sql`, copy the full file contents, paste them into the SQL editor, and select **Run**.
7. Go to **Table Editor** and confirm tables such as `matter_items`, `reading_sessions`, `annotations`, `daily_stats`, and `sync_runs` exist.

Run migration files in timestamp order, oldest first. If a migration fails, read the error message, fix the failed statement, and rerun only after you know whether any earlier statements already succeeded.

### Option B: Supabase CLI

Use this option if you already use the Supabase CLI locally.

```bash
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

Replace `your-project-ref` with the reference from your Supabase project URL or dashboard. After the command succeeds, confirm the tables exist in the Supabase **Table Editor**.

## 3. Set Vercel environment variables

1. Sign in to [Vercel](https://vercel.com/dashboard).
2. Open the Vercel project after importing it, or import it first using the steps in the next section and then return here.
3. Go to **Settings** > **Environment Variables**.
4. Add each variable below for **Production**. If you want preview deployments to work too, also select **Preview**.

| Variable | Where to get it | Visibility |
| --- | --- | --- |
| `APP_ACCESS_PASSWORD` | Create a strong private password that you will type on `/login`. | Server-only secret |
| `MATTER_API_TOKEN` | Your Matter API token. | Server-only secret |
| `SUPABASE_URL` | Supabase Project URL. | Server-only secret |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role or secret server key. | Server-only secret |
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase Project URL. | Browser-safe public value |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon or publishable key. | Browser-safe public value |

5. Select **Save** after adding each variable.
6. If you edited variables after a deployment already ran, trigger a new deployment so Vercel rebuilds with the new values.

Do not add `NEXT_PUBLIC_` to `MATTER_API_TOKEN`, `APP_ACCESS_PASSWORD`, or `SUPABASE_SERVICE_ROLE_KEY`. Only variables intentionally needed in the browser should use `NEXT_PUBLIC_`.

## 4. Deploy from GitHub to Vercel

1. Push this repository to GitHub.
2. In Vercel, select **Add New** > **Project**.
3. Choose the GitHub repository.
4. Keep the detected framework as **Next.js**.
5. Use the default build settings unless you intentionally changed the project:
   - Install command: `npm install`
   - Build command: `npm run build`
   - Output directory: Vercel default for Next.js
6. Add the environment variables from the previous section if you have not already added them.
7. Select **Deploy**.
8. Wait for the build to finish, then open the generated Vercel URL.

After the GitHub integration is connected, Vercel automatically creates a new deployment when you push commits to the connected branch. Pull requests normally receive preview deployments, while the production branch receives production deployments.

## 5. Test the deployed app

Use this checklist after every first deployment, environment-variable change, token rotation, or migration change.

1. Open your Vercel production URL.
2. Visit `/login`.
3. Enter the value you set for `APP_ACCESS_PASSWORD`.
4. Confirm you are redirected into the app and can open `/dashboard`.
5. On `/dashboard`, select **Sync Matter**.
6. Wait for the sync to finish.
   - Success looks like a message with counts for imported items, reading sessions, annotations, and tags.
   - If you see an error, open the Vercel deployment logs and confirm all required environment variables are present.
7. In Supabase **Table Editor**, confirm rows were written to tables such as `matter_items`, `sync_runs`, and `daily_stats`.
8. Refresh `/dashboard`, `/articles`, `/sources`, `/authors`, `/tags`, and `/reports` to confirm pages load with the synced data.

If the app builds but pages fail at runtime, the most common causes are a missing environment variable, a Supabase key pasted into the wrong variable, or migrations that were not run against the same Supabase project used by Vercel.

## 6. Rotate the Matter API token and app password

Rotate secrets if you think they were exposed, when someone who had access should no longer use the app, or on a regular security schedule.

### Rotate the Matter API token

1. Generate a new Matter API token in Matter.
2. In Vercel, open the project and go to **Settings** > **Environment Variables**.
3. Edit `MATTER_API_TOKEN` and replace the old token with the new token for Production and any Preview environments you use.
4. Save the variable.
5. Redeploy the latest production deployment, or push a small commit to trigger a fresh deployment.
6. Open the deployed app, sign in, and run **Sync Matter** from `/dashboard`.
7. Confirm the sync succeeds, then revoke or delete the old Matter API token in Matter if Matter does not automatically invalidate it.

### Rotate the app password

1. Create a new strong password. A password manager-generated value is best.
2. In Vercel, open **Settings** > **Environment Variables**.
3. Edit `APP_ACCESS_PASSWORD` and replace the old password with the new password for Production and any Preview environments you use.
4. Save the variable.
5. Redeploy the latest production deployment, or push a small commit to trigger a fresh deployment.
6. Open `/login` in a private browser window and confirm the old password no longer works and the new password does work.
7. Share the new password only with people who should have access.

Existing browser sessions may continue until their auth cookie expires or is cleared. To force a local re-test, sign out if a sign-out control exists, clear the site cookies, or use a private browser window.
