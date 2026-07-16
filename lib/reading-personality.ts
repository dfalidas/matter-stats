import type { RankedMetric, ReadingMetrics } from "@/lib/metrics-service";

export const READING_PERSONALITY_LABELS = [
  "The Systems Analyst",
  "The News Grazer",
  "The Deep Researcher",
  "The Strategy Reader",
  "The Generalist",
] as const;

export type ReadingPersonalityLabel = (typeof READING_PERSONALITY_LABELS)[number];

export type ReadingPersonality = {
  label: ReadingPersonalityLabel;
  description: string;
};

type PersonalityScore = {
  label: Exclude<ReadingPersonalityLabel, "The Generalist">;
  score: number;
};

const LOW_DATA_MIN_ARTICLES = 3;
const LOW_DATA_MIN_SESSIONS = 3;
const LOW_DATA_MIN_WORDS = 2_000;

const SYSTEMS_TOPICS = [
  "ai",
  "architecture",
  "automation",
  "coding",
  "data",
  "design",
  "engineering",
  "infrastructure",
  "machine learning",
  "programming",
  "science",
  "software",
  "systems",
  "tech",
  "technology",
];

const NEWS_TOPICS = [
  "breaking",
  "current affairs",
  "daily",
  "election",
  "geopolitics",
  "global",
  "headlines",
  "news",
  "politics",
  "policy",
  "world",
];

const RESEARCH_TOPICS = [
  "academic",
  "analysis",
  "book",
  "deep dive",
  "essay",
  "history",
  "journal",
  "longform",
  "paper",
  "psychology",
  "research",
  "science",
];

const STRATEGY_TOPICS = [
  "business",
  "company",
  "economics",
  "finance",
  "growth",
  "investing",
  "leadership",
  "management",
  "market",
  "markets",
  "product",
  "startup",
  "strategy",
  "venture",
];

const NEWS_SOURCES = ["ap", "bbc", "cnn", "guardian", "new york times", "npr", "reuters", "times", "washington post"];
const STRATEGY_SOURCES = ["bloomberg", "economist", "financial times", "forbes", "harvard business review", "hbr", "stratechery", "wall street journal", "wsj"];

const LABEL_TIEBREAK_ORDER: ReadingPersonalityLabel[] = [
  "The Deep Researcher",
  "The Systems Analyst",
  "The Strategy Reader",
  "The News Grazer",
  "The Generalist",
];

export function getDeterministicReadingPersonality(metrics: ReadingMetrics): ReadingPersonality {
  if (hasLowData(metrics)) {
    return buildPersonality("The Generalist", metrics);
  }

  const scores: PersonalityScore[] = [
    { label: "The Systems Analyst", score: scoreSystemsAnalyst(metrics) },
    { label: "The News Grazer", score: scoreNewsGrazer(metrics) },
    { label: "The Deep Researcher", score: scoreDeepResearcher(metrics) },
    { label: "The Strategy Reader", score: scoreStrategyReader(metrics) },
  ];

  const [winner] = scores.sort(
    (a, b) => b.score - a.score || LABEL_TIEBREAK_ORDER.indexOf(a.label) - LABEL_TIEBREAK_ORDER.indexOf(b.label),
  );

  if (!winner || winner.score < 3) {
    return buildPersonality("The Generalist", metrics);
  }

  return buildPersonality(winner.label, metrics);
}

function hasLowData(metrics: ReadingMetrics): boolean {
  return (
    metrics.totals.articlesRead < LOW_DATA_MIN_ARTICLES ||
    metrics.totals.sessionsCount < LOW_DATA_MIN_SESSIONS ||
    metrics.totals.wordsRead < LOW_DATA_MIN_WORDS
  );
}

function scoreSystemsAnalyst(metrics: ReadingMetrics): number {
  return (
    topicScore(metrics.topTags, SYSTEMS_TOPICS) * 2 +
    (topMetricShare(metrics.topTags, metrics.totals.wordsRead) >= 0.35 ? 1 : 0) +
    (metrics.totals.averageSessionLengthSeconds >= 8 * 60 ? 1 : 0)
  );
}

function scoreNewsGrazer(metrics: ReadingMetrics): number {
  const averageWordsPerArticle = metrics.totals.wordsRead / Math.max(metrics.totals.articlesRead, 1);

  return (
    topicScore(metrics.topTags, NEWS_TOPICS) * 2 +
    sourceScore(metrics.topSources, NEWS_SOURCES) +
    (averageWordsPerArticle <= 1_500 ? 2 : 0) +
    (metrics.totals.averageSessionLengthSeconds <= 7 * 60 ? 1 : 0) +
    (metrics.totals.articlesRead >= 10 ? 1 : 0) +
    (metrics.topSources.length >= 4 ? 1 : 0)
  );
}

function scoreDeepResearcher(metrics: ReadingMetrics): number {
  const averageWordsPerArticle = metrics.totals.wordsRead / Math.max(metrics.totals.articlesRead, 1);
  const sessionsPerArticle = metrics.totals.sessionsCount / Math.max(metrics.totals.articlesRead, 1);

  return (
    topicScore(metrics.topTags, RESEARCH_TOPICS) * 2 +
    (averageWordsPerArticle >= 2_500 ? 2 : 0) +
    (metrics.totals.averageSessionLengthSeconds >= 12 * 60 ? 2 : 0) +
    (sessionsPerArticle >= 1.5 ? 1 : 0)
  );
}

function scoreStrategyReader(metrics: ReadingMetrics): number {
  return (
    topicScore(metrics.topTags, STRATEGY_TOPICS) * 2 +
    sourceScore(metrics.topSources, STRATEGY_SOURCES) +
    (metrics.totals.averageSessionLengthSeconds >= 6 * 60 ? 1 : 0)
  );
}

function topicScore(topics: RankedMetric[], keywords: string[]): number {
  return topics.reduce((score, topic, index) => {
    if (!matchesAnyKeyword(topic.name, keywords)) {
      return score;
    }

    return score + Math.max(1, 3 - index);
  }, 0);
}

function sourceScore(sources: RankedMetric[], keywords: string[]): number {
  return sources.reduce((score, source, index) => {
    if (!matchesAnyKeyword(source.name, keywords)) {
      return score;
    }

    return score + Math.max(1, 2 - index);
  }, 0);
}

function matchesAnyKeyword(value: string, keywords: string[]): boolean {
  const normalized = value.toLocaleLowerCase("en");
  return keywords.some((keyword) => normalized.includes(keyword));
}

function topMetricShare(metrics: RankedMetric[], totalWords: number): number {
  if (metrics.length === 0 || totalWords <= 0) {
    return 0;
  }

  return metrics[0].wordsRead / totalWords;
}

function buildPersonality(label: ReadingPersonalityLabel, metrics: ReadingMetrics): ReadingPersonality {
  const topic = describeTopTopic(metrics.topTags);
  const pattern = describeReadingPattern(metrics);

  switch (label) {
    case "The Systems Analyst":
      return {
        label,
        description: `Your reading clusters around ${topic}, and ${pattern}. You seem drawn to how ideas, tools, and systems fit together.`,
      };
    case "The News Grazer":
      return {
        label,
        description: `Your queue favors ${topic}, and ${pattern}. You keep a wide-angle view by sampling timely reads in manageable bursts.`,
      };
    case "The Deep Researcher":
      return {
        label,
        description: `Your year leans into ${topic}, and ${pattern}. You tend to stay with substantial reads long enough to build context.`,
      };
    case "The Strategy Reader":
      return {
        label,
        description: `Your reading points toward ${topic}, and ${pattern}. You gravitate to decisions, markets, products, and long-term tradeoffs.`,
      };
    case "The Generalist":
      return {
        label,
        description: hasLowData(metrics)
          ? "Your synced reading history is still taking shape. As more sessions arrive, this neutral profile will become more specific."
          : `Your reading spans ${topic}, and ${pattern}. No single pattern dominates yet, which makes you a balanced generalist.`,
      };
    default: {
      const exhaustive: never = label;
      return exhaustive;
    }
  }
}

function describeTopTopic(topTags: RankedMetric[]): string {
  if (topTags.length === 0) {
    return "a broad mix of topics";
  }

  const names = topTags.slice(0, 2).map((tag) => tag.name);
  return names.length === 1 ? names[0] : `${names[0]} and ${names[1]}`;
}

function describeReadingPattern(metrics: ReadingMetrics): string {
  const averageWordsPerArticle = metrics.totals.wordsRead / Math.max(metrics.totals.articlesRead, 1);

  if (averageWordsPerArticle >= 2_500 || metrics.totals.averageSessionLengthSeconds >= 12 * 60) {
    return "your sessions skew longer than a quick skim";
  }

  if (averageWordsPerArticle <= 1_500 || metrics.totals.averageSessionLengthSeconds <= 7 * 60) {
    return "your sessions skew short and frequent";
  }

  if (metrics.topSources.length >= 4 || metrics.topTags.length >= 4) {
    return "your sources and topics stay varied";
  }

  return "your reading pace is balanced";
}
