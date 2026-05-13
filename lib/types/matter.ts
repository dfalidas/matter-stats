export type TimeRange = "day" | "week" | "month" | "year" | "all";

export type Article = {
  id: string;
  matterId: string;
  title: string;
  url: string;
  source: string | null;
  author: string | null;
  wordCount: number;
  readingTimeMinutes: number;
  status: "queued" | "reading" | "read" | "archived";
  readAt: string | null;
  createdAt: string;
  tags: string[];
};

export type ReadingSession = {
  id: string;
  articleId: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  wordsRead: number;
};

export type Highlight = {
  id: string;
  articleId: string;
  text: string;
  note: string | null;
  createdAt: string;
};

export type DashboardMetric = {
  label: string;
  value: string;
  delta?: string;
};

export type TrendPoint = {
  date: string;
  minutes: number;
  words: number;
  articles: number;
};

export type RankedStat = {
  label: string;
  value: number;
};

export type DashboardSummary = {
  metrics: DashboardMetric[];
  trends: TrendPoint[];
  topSources: RankedStat[];
  topAuthors: RankedStat[];
  topTags: RankedStat[];
  recentArticles: Article[];
  currentStreakDays: number;
  bestStreakDays: number;
};
