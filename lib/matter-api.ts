import "server-only";

import { serverEnv } from "@/lib/env";
import { parseRetryAfterHeader } from "@/lib/matter-sync-progress";

const MATTER_API_BASE_URL = "https://api.getmatter.com/public/v1";
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_RATE_LIMIT_RETRIES = 0;
const MAX_RATE_LIMIT_DELAY_MS = 60_000;
const MIN_MATTER_REQUEST_INTERVAL_MS = 250;

let lastMatterRequestStartedAt = 0;

type QueryValue = string | number | boolean | Date | null | undefined | readonly (string | number | boolean)[];

type MatterFetchOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: BodyInit | Record<string, unknown> | null;
  headers?: HeadersInit;
  query?: Record<string, QueryValue>;
  maxRateLimitRetries?: number;
};

export type MatterObjectType =
  | "account"
  | "annotation"
  | "author"
  | "item"
  | "list"
  | "reading_session"
  | "tag";

export type MatterRateLimitHeaders = {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
  retryAfterSeconds: number | null;
};

export type MatterErrorBody = {
  error?: {
    code?: string;
    message?: string;
    field?: string | null;
  };
};

export type MatterListResponse<T> = {
  object: "list";
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
};

export type MatterPageParams = {
  limit?: number;
  cursor?: string;
};

export type MatterAccount = {
  object: "account";
  id: string;
  name: string;
  email: string;
  rate_limit: {
    read: number;
    write: number;
    save: number;
    search: number;
    markdown: number;
    burst: number;
  };
  created_at: string;
};

export type MatterAuthor = {
  object: "author";
  id: string;
  name: string;
};

export type MatterTag = {
  object: "tag";
  id: string;
  name: string;
  item_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type MatterItemStatus = "inbox" | "queue" | "archive";
export type MatterItemOrder = "updated" | "library_position" | "inbox_position";
export type MatterContentType = "article" | "video" | "podcast" | "pdf" | "tweet" | "newsletter";
export type MatterProcessingStatus = "processing" | "completed" | "failed";

export type MatterItem = {
  object: "item";
  id: string;
  title: string;
  url: string;
  site_name?: string | null;
  author?: MatterAuthor | null;
  status: MatterItemStatus;
  processing_status?: MatterProcessingStatus;
  is_favorite: boolean;
  content_type: MatterContentType;
  word_count?: number | null;
  reading_progress: number;
  image_url?: string | null;
  markdown?: string | null;
  excerpt?: string | null;
  library_position?: number | null;
  inbox_position?: number | null;
  tags: MatterTag[];
  created_at?: string;
  updated_at: string;
};

export type ListMatterItemsParams = MatterPageParams & {
  status?: MatterItemStatus | "all" | readonly MatterItemStatus[];
  order?: MatterItemOrder;
  isFavorite?: boolean;
  tag?: string | readonly string[];
  contentType?: MatterContentType | readonly MatterContentType[];
  updatedSince?: string | Date;
  include?: "markdown" | readonly "markdown"[];
};

export type MatterReadingSession = {
  object?: "reading_session" | string | null;
  id: string;
  date?: string | null;
  started_at?: string | null;
  startedAt?: string | null;
  ended_at?: string | null;
  endedAt?: string | null;
  seconds_read?: number | null;
  secondsRead?: number | null;
  duration_seconds?: number | null;
  durationSeconds?: number | null;
  item_id?: string | null;
  itemId?: string | null;
  library_item_id?: string | null;
  libraryItemId?: string | null;
  target_id?: string | null;
  targetId?: string | null;
  item?: string | Partial<MatterItem> | null;
  library_item?: string | Partial<MatterItem> | null;
  libraryItem?: string | Partial<MatterItem> | null;
  target?: string | Partial<MatterItem> | null;
  source_device?: string | null;
  sourceDevice?: string | null;
  device?: string | null;
};

export type ListMatterReadingSessionsParams = MatterPageParams & {
  since?: string | Date;
};

export type MatterAnnotation = {
  object: "annotation";
  id: string;
  item_id: string;
  text: string;
  note?: string | null;
  created_at: string;
  updated_at: string;
};

export type ListMatterAnnotationsParams = MatterPageParams;
export type ListMatterTagsParams = MatterPageParams & {
  updatedSince?: string | Date;
};

export class MatterApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly field: string | null;
  readonly path: string;
  readonly rateLimit: MatterRateLimitHeaders;

  constructor(args: {
    status: number;
    code?: string | null;
    message: string;
    field?: string | null;
    path: string;
    rateLimit: MatterRateLimitHeaders;
  }) {
    super(args.message);
    this.name = "MatterApiError";
    this.status = args.status;
    this.code = args.code ?? null;
    this.field = args.field ?? null;
    this.path = args.path;
    this.rateLimit = args.rateLimit;
  }
}

export class MatterRateLimitError extends MatterApiError {
  constructor(args: { message: string; path: string; rateLimit: MatterRateLimitHeaders }) {
    super({
      status: 429,
      code: "rate_limited",
      message: args.message,
      path: args.path,
      rateLimit: args.rateLimit,
    });
    this.name = "MatterRateLimitError";
  }
}

export async function matterFetch<T>(path: string, options: MatterFetchOptions = {}): Promise<T> {
  const { maxRateLimitRetries = DEFAULT_MAX_RATE_LIMIT_RETRIES, ...fetchOptions } = options;

  for (let attempt = 0; attempt <= maxRateLimitRetries; attempt += 1) {
    await paceMatterRequest();

    const response = await fetch(buildMatterUrl(path, fetchOptions.query), {
      ...fetchOptions,
      headers: buildHeaders(fetchOptions.headers, fetchOptions.body),
      body: buildBody(fetchOptions.body),
    });

    if (response.status === 429) {
      const rateLimit = parseRateLimitHeaders(response.headers);
      const errorBody = await readErrorBody(response);
      const message = formatErrorMessage(response.status, errorBody, rateLimit);

      if (attempt < maxRateLimitRetries && rateLimit.retryAfterSeconds !== null) {
        const delayMs = rateLimit.retryAfterSeconds * 1_000;
        if (delayMs > 0 && delayMs <= MAX_RATE_LIMIT_DELAY_MS) {
          await sleep(delayMs);
          continue;
        }
      }

      throw new MatterRateLimitError({ message, path, rateLimit });
    }

    if (!response.ok) {
      const rateLimit = parseRateLimitHeaders(response.headers);
      const errorBody = await readErrorBody(response);
      const error = errorBody.error;
      throw new MatterApiError({
        status: response.status,
        code: error?.code ?? null,
        message: formatErrorMessage(response.status, errorBody, rateLimit),
        field: error?.field ?? null,
        path,
        rateLimit,
      });
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  throw new MatterRateLimitError({
    message: "Matter API rate limit exceeded after retry attempts.",
    path,
    rateLimit: { limit: null, remaining: null, reset: null, retryAfterSeconds: null },
  });
}

export function logMatterApiError(error: unknown, context: string): void {
  if (error instanceof MatterApiError) {
    console.error("Matter API request failed", {
      context,
      status: error.status,
      code: error.code,
      field: error.field,
      path: error.path,
      retryAfterSeconds: error.rateLimit.retryAfterSeconds,
      rateLimitReset: error.rateLimit.reset,
    });
    return;
  }

  console.error("Matter API request failed", {
    context,
    message: error instanceof Error ? error.message : "Unknown error",
  });
}

export async function getMatterAccount(): Promise<MatterAccount> {
  return matterFetch<MatterAccount>("/me");
}

export async function listMatterItems(params: ListMatterItemsParams = {}): Promise<MatterListResponse<MatterItem>> {
  return matterFetch<MatterListResponse<MatterItem>>("/items", { query: toMatterItemsQuery(params) });
}

export async function getMatterItem(itemId: string): Promise<MatterItem> {
  return matterFetch<MatterItem>(`/items/${encodeURIComponent(itemId)}`);
}

export async function listMatterReadingSessions(
  params: ListMatterReadingSessionsParams = {}
): Promise<MatterListResponse<MatterReadingSession>> {
  return matterFetch<MatterListResponse<MatterReadingSession>>("/reading_sessions", {
    query: {
      limit: params.limit,
      cursor: params.cursor,
      since: formatDateParam(params.since),
    },
  });
}

export async function listMatterTags(params: ListMatterTagsParams = {}): Promise<MatterListResponse<MatterTag>> {
  return matterFetch<MatterListResponse<MatterTag>>("/tags", {
    query: {
      limit: params.limit,
      cursor: params.cursor,
      updated_since: formatDateParam(params.updatedSince),
    },
  });
}

export async function listMatterAnnotations(
  itemId: string,
  params: ListMatterAnnotationsParams = {}
): Promise<MatterListResponse<MatterAnnotation>> {
  return matterFetch<MatterListResponse<MatterAnnotation>>(`/items/${encodeURIComponent(itemId)}/annotations`, {
    query: {
      limit: params.limit,
      cursor: params.cursor,
    },
  });
}

export async function* paginateMatter<T>(
  fetchPage: (cursor?: string) => Promise<MatterListResponse<T>>
): AsyncGenerator<T, void, unknown> {
  let cursor: string | undefined;

  do {
    const page = await fetchPage(cursor);

    for (const result of page.results) {
      yield result;
    }

    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (cursor);
}

export async function collectMatterPages<T>(
  fetchPage: (cursor?: string) => Promise<MatterListResponse<T>>
): Promise<T[]> {
  const results: T[] = [];

  for await (const result of paginateMatter(fetchPage)) {
    results.push(result);
  }

  return results;
}

export function iterateMatterItems(params: Omit<ListMatterItemsParams, "cursor"> = {}): AsyncGenerator<MatterItem, void, unknown> {
  return paginateMatter((cursor) => listMatterItems({ limit: DEFAULT_PAGE_LIMIT, ...params, cursor }));
}

export function iterateMatterReadingSessions(
  params: Omit<ListMatterReadingSessionsParams, "cursor"> = {}
): AsyncGenerator<MatterReadingSession, void, unknown> {
  return paginateMatter((cursor) => listMatterReadingSessions({ limit: DEFAULT_PAGE_LIMIT, ...params, cursor }));
}

export function iterateMatterTags(params: Omit<ListMatterTagsParams, "cursor"> = {}): AsyncGenerator<MatterTag, void, unknown> {
  return paginateMatter((cursor) => listMatterTags({ limit: DEFAULT_PAGE_LIMIT, ...params, cursor }));
}

export function iterateMatterAnnotations(
  itemId: string,
  params: Omit<ListMatterAnnotationsParams, "cursor"> = {}
): AsyncGenerator<MatterAnnotation, void, unknown> {
  return paginateMatter((cursor) => listMatterAnnotations(itemId, { limit: DEFAULT_PAGE_LIMIT, ...params, cursor }));
}

function buildMatterUrl(path: string, query?: Record<string, QueryValue>): URL {
  const url = new URL(path.replace(/^\/+/, ""), `${MATTER_API_BASE_URL}/`);

  if (!query) {
    return url;
  }

  for (const [key, value] of Object.entries(query)) {
    const queryValue = serializeQueryValue(value);
    if (queryValue !== null) {
      url.searchParams.set(key, queryValue);
    }
  }

  return url;
}

function buildHeaders(headers: HeadersInit | undefined, body: MatterFetchOptions["body"]): Headers {
  const nextHeaders = new Headers(headers);
  nextHeaders.set("Accept", "application/json");
  nextHeaders.set("Authorization", `Bearer ${serverEnv.matterApiToken}`);

  if (body && !(body instanceof FormData) && !nextHeaders.has("Content-Type")) {
    nextHeaders.set("Content-Type", "application/json");
  }

  return nextHeaders;
}

function buildBody(body: MatterFetchOptions["body"]): BodyInit | null | undefined {
  if (!body || isBodyInit(body)) {
    return body;
  }

  return JSON.stringify(body);
}

function isBodyInit(body: MatterFetchOptions["body"]): body is BodyInit {
  return (
    typeof body === "string" ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ReadableStream
  );
}

function toMatterItemsQuery(params: ListMatterItemsParams): Record<string, QueryValue> {
  return {
    status: params.status,
    order: params.order,
    is_favorite: params.isFavorite,
    tag: params.tag,
    content_type: params.contentType,
    updated_since: formatDateParam(params.updatedSince),
    include: params.include,
    limit: params.limit,
    cursor: params.cursor,
  };
}

function serializeQueryValue(value: QueryValue): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(String).join(",") : null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function formatDateParam(value: string | Date | undefined): string | undefined {
  return value instanceof Date ? value.toISOString() : value;
}

async function readErrorBody(response: Response): Promise<MatterErrorBody> {
  try {
    return (await response.json()) as MatterErrorBody;
  } catch {
    return {};
  }
}

function formatErrorMessage(status: number, body: MatterErrorBody, rateLimit: MatterRateLimitHeaders): string {
  const apiMessage = body.error?.message;

  if (status === 429) {
    const retryText = rateLimit.retryAfterSeconds === null ? "later" : `after ${rateLimit.retryAfterSeconds} seconds`;
    return apiMessage ?? `Matter API rate limit exceeded. Retry ${retryText}.`;
  }

  return apiMessage ?? `Matter API request failed with HTTP ${status}.`;
}

export function parseRateLimitHeaders(headers: Headers): MatterRateLimitHeaders {
  return {
    limit: parseIntegerHeader(headers.get("X-RateLimit-Limit")),
    remaining: parseIntegerHeader(headers.get("X-RateLimit-Remaining")),
    reset: parseIntegerHeader(headers.get("X-RateLimit-Reset")),
    retryAfterSeconds: parseRetryAfterHeader(headers.get("Retry-After")),
  };
}

function parseIntegerHeader(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function paceMatterRequest(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(lastMatterRequestStartedAt + MIN_MATTER_REQUEST_INTERVAL_MS - now, 0);

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  lastMatterRequestStartedAt = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
