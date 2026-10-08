import "server-only";

import { validateMatterPage, MatterPageValidationError } from "./matter-page-plan";
import { admitMatterRequest, getMatterRequestRuntime, matterRequestIdentity } from "./matter-request-coordinator";
import { strictMatterInteger, strictMatterReset, matterCooldownDeadline, isTransientMatterFailure, matterRetryDelay } from "./matter-request-policy";
import type { Json } from "./supabase-types";
import { MatterBudgetStop, getMatterInvocationBudget } from "./matter-invocation-budget";

import { serverEnv } from "@/lib/env";
import { parseRetryAfterHeader } from "@/lib/matter-sync-progress";

const MATTER_API_BASE_URL = "https://api.getmatter.com/public/v1";
const DEFAULT_PAGE_LIMIT = 100;
type QueryValue = string | number | boolean | Date | null | undefined | readonly (string | number | boolean)[];

type MatterFetchOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: BodyInit | Record<string, unknown> | null;
  headers?: HeadersInit;
  query?: Record<string, QueryValue>;
  beforeRequest?: () => Promise<void>;
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
  const { beforeRequest, ...fetchOptions } = options;
  if (fetchOptions.method && fetchOptions.method.toUpperCase() !== "GET") throw new Error("Matter coordinator supports idempotent GET reads only");
  const url = buildMatterUrl(path, fetchOptions.query);
  const budget = getMatterInvocationBudget();
  const runtime = getMatterRequestRuntime();
  const identity = matterRequestIdentity(url);
  for (;;) {
    const admission = await admitMatterRequest(url, beforeRequest, fetchOptions.signal ?? undefined);
    if (admission.reason === "cached") {
      await beforeRequest?.();
      if (admission.entry?.protocol) throw new MatterPageValidationError("persisted_protocol_failure");
      if (admission.entry?.status) throw new MatterApiError({ status: admission.entry.status, message: "Previously unavailable Matter endpoint", path, rateLimit: emptyRateLimit() });
      validateReadResponse(url, admission.entry?.value);
      return admission.entry?.value as T;
    }
    const sequence = admission.sequence!;
    const localTimeout = budget ? null : AbortSignal.timeout(10_000);
    const finish = (entry: Json) => runtime.store.finish({ p_slot: identity.p_slot, p_key: identity.p_key, p_sequence: sequence, p_entry: entry, p_lease: identity.p_lease });
    const readResponse = async (signal?: AbortSignal): Promise<T> => {
      fetchOptions.signal?.throwIfAborted();
      await beforeRequest?.();
      const response = await fetch(url, {
        ...fetchOptions,
        ...(signal ? { signal: fetchOptions.signal ? AbortSignal.any([signal, fetchOptions.signal]) : signal } : { signal: fetchOptions.signal ? AbortSignal.any([fetchOptions.signal, localTimeout!]) : localTimeout! }),
        headers: buildHeaders(fetchOptions.headers, fetchOptions.body), body: buildBody(fetchOptions.body),
      });
      const now = runtime.now();
      const rateLimit = parseRateLimitHeaders(response.headers, now);
      const cooldown = response.status === 429 ? matterCooldownDeadline(rateLimit.retryAfterSeconds, rateLimit.reset, now) : null;
      // This feedback can only restrict shared account capacity, so a stale lease
      // cannot replenish quota. Sync-owned preparation still requires its fence.
      try { await runtime.store.feedback({ p_sequence: sequence, p_limit: rateLimit.limit, p_remaining: rateLimit.remaining,
        p_reset: rateLimit.reset === null ? null : new Date(rateLimit.reset * 1000).toISOString(), p_cooldown: cooldown === null ? null : new Date(cooldown).toISOString() }); }
      catch { throw new Error("Matter shared feedback could not be verified"); }
      await beforeRequest?.();
      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        if (response.status === 429) throw new MatterRateLimitError({ message: formatErrorMessage(response.status, errorBody, rateLimit), path, rateLimit });
        throw new MatterApiError({ status: response.status, code: errorBody.error?.code ?? null,
          message: formatErrorMessage(response.status, errorBody, rateLimit), field: errorBody.error?.field ?? null, path, rateLimit });
      }
      let value: unknown;
      try { value = await response.json(); }
      catch (error) { if (signal?.aborted) throw signal.reason; if (fetchOptions.signal?.aborted) throw fetchOptions.signal.reason; if (isTransientMatterFailure(error)) throw error; throw new MatterPageValidationError("invalid_json"); }
      validateReadResponse(url, value);
      await beforeRequest?.();
      return value as T;
    };
    let value: T;
    try {
      value = budget ? await budget.attempt(readResponse) : await readResponse();
    } catch (error) {
      if (fetchOptions.signal?.aborted) throw fetchOptions.signal.reason;
      if (localTimeout?.aborted) error = new MatterBudgetStop("timeout");
      await beforeRequest?.();
      if (error instanceof MatterRateLimitError) { await finish({ quota: true }); throw error; }
      if (isTransientMatterFailure(error)) {
        await finish({ transient_delay_ms: matterRetryDelay(admission.attempt!, runtime.random) });
        budget?.check();
        continue; // admission reads the persisted next eligibility and attempt count
      }
      if (error instanceof MatterPageValidationError) await finish({ protocol: true });
      if (error instanceof MatterApiError && [401, 403, 404, 400, 422].includes(error.status)) await finish({ status: error.status });
      throw error;
    }
    fetchOptions.signal?.throwIfAborted();
    await beforeRequest?.();
    // Never classify or retry an ambiguous database outcome as HTTP failure.
    await finish({ value: value as Json });
    return value;
  }
}
function emptyRateLimit(): MatterRateLimitHeaders { return { limit: null, remaining: null, reset: null, retryAfterSeconds: null }; }
function validateReadResponse(url: URL, value: unknown) {
  const path = url.pathname;
  if (["/items", "/reading_sessions", "/tags"].some((endpoint) => path.endsWith(endpoint)) || path.endsWith("/annotations")) {
    validateMatterPage(value as MatterListResponse<unknown>, Number(url.searchParams.get("limit") ?? 25), url.searchParams.get("cursor"));
  } else if (!value || typeof value !== "object" || Array.isArray(value) || (path !== "/public/v1/me" && (typeof (value as { id?: unknown }).id !== "string" || !(value as { id: string }).id.trim()))) {
    throw new MatterPageValidationError("invalid_envelope");
  }
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

export async function getMatterAccount(beforeRequest?: () => Promise<void>): Promise<MatterAccount> {
  return matterFetch<MatterAccount>("/me", { beforeRequest });
}

export async function listMatterItems(params: ListMatterItemsParams = {}, beforeRequest?: () => Promise<void>): Promise<MatterListResponse<MatterItem>> {
  return matterFetch<MatterListResponse<MatterItem>>("/items", { query: toMatterItemsQuery(params), beforeRequest });
}

export async function getMatterItem(itemId: string, beforeRequest?: () => Promise<void>): Promise<MatterItem> {
  return matterFetch<MatterItem>(`/items/${encodeURIComponent(itemId)}`, { beforeRequest });
}

export async function listMatterReadingSessions(
  params: ListMatterReadingSessionsParams = {},
  beforeRequest?: () => Promise<void>
): Promise<MatterListResponse<MatterReadingSession>> {
  return matterFetch<MatterListResponse<MatterReadingSession>>("/reading_sessions", {
    beforeRequest,
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
  params: ListMatterAnnotationsParams = {},
  beforeRequest?: () => Promise<void>
): Promise<MatterListResponse<MatterAnnotation>> {
  return matterFetch<MatterListResponse<MatterAnnotation>>(`/items/${encodeURIComponent(itemId)}/annotations`, {
    beforeRequest,
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
  const seen = new Set<string>();
  do {
    const page = await fetchPage(cursor);
    validateMatterPage(page, 100, cursor ?? null);
    if (page.next_cursor) {
      if (seen.has(page.next_cursor) || seen.size >= 10000) throw new MatterPageValidationError("iterator_cursor_loop_or_bound");
      seen.add(page.next_cursor);
    }

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

export function parseRateLimitHeaders(headers: Headers, now = Date.now()): MatterRateLimitHeaders {
  const limit = strictMatterInteger(headers.get("X-RateLimit-Limit"));
  const remaining = strictMatterInteger(headers.get("X-RateLimit-Remaining"));
  return { limit: limit && limit > 0 ? limit : null,
    remaining: remaining !== null && remaining <= (limit ?? 120) ? remaining : null,
    reset: strictMatterReset(headers.get("X-RateLimit-Reset"), now),
    retryAfterSeconds: parseRetryAfterHeader(headers.get("Retry-After"), now) };
}
