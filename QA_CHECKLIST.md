# QA Checklist

Use this checklist before shipping changes to Matter Stats. Run it against a clean local database or a staging Supabase project when possible, and record the browser, viewport, commit SHA, environment, and tester name in the QA notes.

## Prerequisites

1. Confirm dependencies are installed with `npm install`.
2. Confirm the app can be started with `npm run dev` and loads at `http://localhost:3000`.
3. Have access to:
   - A valid app password for `APP_ACCESS_PASSWORD`.
   - A valid Matter API token with a library that contains read, archived, annotated, and favorited articles.
   - An invalid or expired Matter API token for negative testing.
   - A Supabase project that can be reset or safely modified.
4. Open browser developer tools before testing:
   - **Console** tab for client errors.
   - **Network** tab for request status, redirects, and response payload checks.
   - **Application/Storage** tab for cookie checks.
5. Unless a step says otherwise, verify there are no unexpected browser console errors and no unhandled server errors in the dev server logs.

## 1. Login gate

1. Clear site data for `localhost:3000`, including cookies and local storage.
2. Navigate directly to `http://localhost:3000/dashboard`.
3. Verify the app redirects to `/login` instead of rendering dashboard content.
4. Enter an incorrect password and submit.
5. Verify an error message appears and the user remains on `/login`.
6. Enter the correct app password and submit.
7. Verify the app redirects to `/dashboard`.
8. In browser storage, verify the auth cookie is set and is HTTP-only where the browser exposes that flag.
9. Open a new tab and navigate directly to `/articles`, `/reports`, `/settings`, and `/year-in-reading`.
10. Verify each protected route loads without asking for the password again.

## 2. Environment variable handling

1. Stop the development server.
2. Remove or blank each required server-only variable one at a time:
   - `APP_ACCESS_PASSWORD`
   - `MATTER_API_TOKEN`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Start the server or trigger a server-side feature after each removal.
4. Verify the failure message clearly names the missing variable and does not reveal any secret values.
5. Restore all server-only variables.
6. Remove or blank each required public Supabase variable one at a time:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
7. Load a page that uses the browser Supabase client.
8. Verify the UI fails gracefully or shows an actionable setup error, and that only browser-safe public variable names are mentioned.
9. Restore all variables and restart the server.
10. Verify `/dashboard` loads successfully after restoration.

## 3. First sync

1. Reset the QA database or delete existing imported Matter rows so the account has no synced articles, sources, authors, tags, reports, or sync run history.
2. Log in and navigate to `/dashboard`.
3. Click the Matter sync button once.
4. Verify the button enters a loading or disabled state while the sync is running.
5. Verify the sync finishes with a success message or visible updated timestamp.
6. Verify the dashboard metrics change from the empty state to populated counts.
7. Verify the database contains the expected new article, source, author, tag, daily stat, and sync run records.
8. Verify the sync run log records a successful first run with a realistic started time, completed time, duration, and imported count.
9. Refresh `/dashboard`.
10. Verify the synced data persists after refresh.

## 4. Repeat sync

1. Start from a database that already completed a successful first sync.
2. Click the Matter sync button again.
3. Verify the sync completes successfully without creating duplicate articles, duplicate sources, duplicate authors, or duplicate tags.
4. Verify updated records are refreshed if Matter data changed between runs.
5. Verify the sync run history shows a new successful run.
6. Verify aggregate dashboard counts remain accurate after the repeat sync.
7. Refresh `/articles` and verify the article list still has one row per Matter article.

## 5. Failed Matter token

1. Stop the server and replace `MATTER_API_TOKEN` with an invalid, expired, or intentionally malformed token.
2. Restart the server and log in.
3. Click the Matter sync button.
4. Verify the sync fails gracefully with a clear, non-secret error message.
5. Verify the invalid token value is not displayed in the UI, browser console, network response, or server logs.
6. Verify no partial or corrupt records are inserted.
7. Verify the sync run log records the failure status and a sanitized error summary.
8. Restore the valid `MATTER_API_TOKEN`, restart the server, and verify sync works again.

## 6. Empty dashboard

1. Use a QA database with no synced Matter data.
2. Log in and navigate to `/dashboard`.
3. Verify the page renders without crashing or infinite loading.
4. Verify cards, charts, tables, and trend sections show helpful empty states rather than `NaN`, `undefined`, blank axes, or broken layout.
5. Verify primary actions, such as syncing Matter data, are visible and usable.
6. Verify the page remains usable after refresh.

## 7. Dashboard with data

1. Use a QA database with a completed successful sync and enough data to populate metrics, charts, recent activity, and rankings.
2. Navigate to `/dashboard`.
3. Verify top-level counts match database totals for read articles, saved articles, annotations, favorites, or other displayed metrics.
4. Verify charts render with labels, legends, and tooltips where expected.
5. Verify source, author, tag, and article summaries match known test data.
6. Verify recent sync metadata is visible and accurate.
7. Verify refresh does not change counts unexpectedly.
8. Verify no component shows placeholder copy that should only appear in an empty state.

## 8. Period selector

1. Navigate to every page that has a period selector, starting with `/dashboard`.
2. Select each available period option, such as week, month, year, all time, or any custom range the UI supports.
3. Verify the selected option is visibly active.
4. Verify metrics, charts, rankings, and tables update to match the selected period.
5. Verify the URL, query string, or persisted state behaves as designed after refresh and browser back/forward navigation.
6. Verify selecting a period with no data shows an empty state without errors.
7. Verify period boundaries are correct at the start and end of weeks, months, and years.

## 9. Weekly report

1. Navigate to `/reports`.
2. Select the weekly report view or the most recent available week.
3. Verify the report includes the correct week label and date range.
4. Verify totals and highlights match the database for that week.
5. Verify sections for sources, authors, tags, articles, annotations, and reading trends render correctly when data exists.
6. Select a week with no data.
7. Verify the report shows a useful empty state and does not display stale data from the previous week.
8. Verify report navigation works with refresh and browser back/forward.

## 10. Year in Reading page

1. Navigate to `/year-in-reading`.
2. Select the current year and any previous year with available data.
3. Verify the year label, totals, charts, top sources, top authors, top tags, and notable articles match the database for the selected year.
4. Verify the page handles years with partial data, such as the current year, without implying the year is complete.
5. Select a year with no data.
6. Verify the empty state is clear and the layout remains stable.
7. Refresh the page and verify the selected year or default year behavior is correct.

## 11. Article detail page

1. Navigate to `/articles` and open an article with complete metadata.
2. Verify the detail page URL uses the expected article id and loads without errors.
3. Verify title, source, author, published date, saved/read state, favorite state, tags, excerpt, and Matter link match the database.
4. Open an article that has annotations or highlights.
5. Verify annotations render in the correct order and do not break formatting.
6. Open an article with missing optional metadata, such as no author, no image, no tags, or no excerpt.
7. Verify the page shows sensible fallbacks and does not display raw `null` or `undefined` values.
8. Navigate directly to a non-existent article id.
9. Verify the app returns the expected not-found or error state without exposing internal details.

## 12. Settings page

1. Navigate to `/settings`.
2. Verify current app configuration and connection status are displayed only at a safe level, with no secret values revealed.
3. Verify any configurable fields validate required input, formatting, and maximum length.
4. Save a valid settings change.
5. Verify the success state appears and the change persists after refresh.
6. Try to save invalid settings.
7. Verify validation messages are specific and the invalid values are not persisted.
8. Verify leaving and returning to `/settings` does not lose saved settings.

## 13. Mobile browser layout

1. Open the app in browser responsive mode at common mobile widths, including 320 px, 375 px, 390 px, and 430 px.
2. Test `/login`, `/dashboard`, `/articles`, an article detail page, `/reports`, `/year-in-reading`, and `/settings`.
3. Verify navigation is reachable, visible, and does not overlap page content.
4. Verify cards, charts, tables, forms, buttons, and sync controls fit within the viewport without horizontal scrolling unless a table intentionally scrolls.
5. Verify tap targets are large enough to use comfortably.
6. Verify loading, empty, success, and error states remain readable.
7. Rotate to landscape orientation and repeat the key dashboard and article detail checks.
8. Test in at least one real mobile browser or device cloud session before release when the change affects layout.

## 14. No secrets exposed in client bundle

1. Build the production app with `npm run build`.
2. Search the generated client assets for server-only variable names and known secret values:
   - `APP_ACCESS_PASSWORD`
   - `MATTER_API_TOKEN`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - The actual configured app password.
   - The actual configured Matter API token.
   - The actual configured Supabase service role key.
3. Verify none of those names or values appear in `.next/static`, `.next/server/app` files intended for client hydration, source maps, network payloads, or browser-visible HTML.
4. Load the production build with `npm run start`.
5. In browser developer tools, inspect page source, network responses, JavaScript chunks, and global variables.
6. Verify only `NEXT_PUBLIC_` browser-safe values are present in client-visible assets.
7. Verify sync, admin Supabase operations, and Matter API calls happen only through server-side code paths.
8. Document the exact search command and result in the QA notes.
