import type { getActivityMonth } from "@/lib/activity-service"; export type AwaitedActivity=Awaited<ReturnType<typeof getActivityMonth>>;
