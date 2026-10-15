import type { ReadingMetrics } from "@/lib/metrics-service";

export function hasSessionMetadataCoverage(metrics: Pick<ReadingMetrics, "topSources" | "topAuthors" | "topTags">): boolean {
  return metrics.topSources.length > 0 || metrics.topAuthors.length > 0 || metrics.topTags.length > 0;
}

export const SESSION_METADATA_EMPTY_STATE = "Session-to-item attribution is unsupported without a documented item identifier. Another metadata sync is not guaranteed to resolve it.";
