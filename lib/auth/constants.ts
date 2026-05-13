export const APP_SESSION_COOKIE = "matter_stats_session";
export const APP_SESSION_VALUE = "authenticated";
export const PROTECTED_PATHS = [
  "/dashboard",
  "/reports",
  "/sources",
  "/authors",
  "/tags",
  "/articles",
  "/year-in-reading",
  "/settings",
  "/api/sync",
] as const;
