/**
 * HTTP adapter for `SyncTransport` (G15).
 *
 * Push POSTs the batch to `POST /api/sync/v1/push` and reads the per-event
 * receipt envelope `{ receipts: SyncReceipt[] }` — one receipt per event, keyed
 * by the store-minted UUID `eventId`. Pull POSTs `{ destination, cursor?, limit }`
 * to `POST /api/sync/v1/pull` and reads a `SyncPullResult`. Both routes are
 * `api/src/presentation/routes/syncRoutes.ts`; a refused request is a 400/403
 * `{ error: code }` and surfaces here as `HttpSyncTransportError` with that code
 * in `detail`.
 *
 * Fetch is injected. This module does not call the network on construction and
 * does not import the API package.
 */

import type { SyncReceipt } from './records.js';
import type { SyncPullResult, SyncPushBatch, SyncTransport, SyncTransportInit } from './sync.js';

/** Push route (`syncRoutes.ts` under `/api/sync/v1`). */
export const HTTP_SYNC_PUSH_PATH = '/api/sync/v1/push';

/** Pull route (`syncRoutes.ts` under `/api/sync/v1`). */
export const HTTP_SYNC_PULL_PATH = '/api/sync/v1/pull';

const RECEIPT_STATUSES = new Set<SyncReceipt['status']>([
  'accepted',
  'duplicate',
  'conflict',
  'rejected',
  'dependency_pending',
]);

export interface HttpSyncResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface HttpSyncRequest {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Aborts the request when the sync run loses its lease. */
  readonly signal?: AbortSignal;
}

/** Injected fetch. Tests pass a fake; a host passes its own fetch. */
export type HttpSyncFetch = (url: string, init: HttpSyncRequest) => Promise<HttpSyncResponse>;

export type HttpSyncHeaders =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>);

export interface HttpSyncTransportOptions {
  readonly fetch: HttpSyncFetch;
  /**
   * Absolute http(s) origin or prefix. A trailing slash is stripped and the
   * path is appended, so an origin base yields a request path of exactly
   * `/api/sync/v1/push` or `/api/sync/v1/pull`. A path-only or blank base is refused
   * before fetch is called.
   */
  readonly baseUrl: string;
  readonly headers?: HttpSyncHeaders;
}

export class HttpSyncTransportError extends Error {
  readonly code: string;
  readonly status: number;
  readonly url: string;
  /** The server's refusal code (`{ error }` body) when it sent one. */
  readonly detail?: string;

  constructor(code: string, status: number, url: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'HttpSyncTransportError';
    this.code = code;
    this.status = status;
    this.url = url;
    if (detail) this.detail = detail;
  }
}

/** The `{ error }` code of a refused request, when the body carries one. */
async function refusalCode(response: HttpSyncResponse): Promise<string | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // A non-JSON error body has no code to report; the status still does.
    return undefined;
  }
  const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  return typeof error === 'string' && error !== '' ? error : undefined;
}

function resolveUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    throw new HttpSyncTransportError('sync_base_url_required', 0, baseUrl);
  }
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function resolveHeaders(headers: HttpSyncHeaders | undefined): Promise<Record<string, string>> {
  const provided = typeof headers === 'function' ? await headers() : headers;
  const merged: Record<string, string> = {};
  if (provided) {
    for (const [key, value] of Object.entries(provided)) {
      if (key.toLowerCase() === 'content-type') continue;
      if (typeof value !== 'string') continue;
      merged[key] = value;
    }
  }
  if (!Object.keys(merged).some((key) => key.toLowerCase() === 'accept')) {
    merged.accept = 'application/json';
  }
  merged['content-type'] = 'application/json';
  return merged;
}

async function postJson(
  options: HttpSyncTransportOptions,
  path: string,
  body: unknown,
  init: SyncTransportInit | undefined,
): Promise<{ url: string; parsed: unknown }> {
  const url = resolveUrl(options.baseUrl, path);
  const response = await options.fetch(url, {
    method: 'POST',
    headers: await resolveHeaders(options.headers),
    body: JSON.stringify(body),
    ...(init?.signal ? { signal: init.signal } : {}),
  });
  if (!response.ok) {
    throw new HttpSyncTransportError('sync_http_status', response.status, url, await refusalCode(response));
  }
  try {
    return { url, parsed: await response.json() };
  } catch {
    throw new HttpSyncTransportError('sync_response_not_json', response.status, url);
  }
}

function readReceipt(value: unknown, url: string): SyncReceipt {
  if (typeof value !== 'object' || value === null) {
    throw new HttpSyncTransportError('sync_receipts_invalid', 200, url);
  }
  const row = value as Record<string, unknown>;
  if (typeof row.eventId !== 'string' || row.eventId === '') {
    throw new HttpSyncTransportError('sync_receipts_invalid', 200, url);
  }
  if (typeof row.status !== 'string' || !RECEIPT_STATUSES.has(row.status as SyncReceipt['status'])) {
    throw new HttpSyncTransportError('sync_receipts_invalid', 200, url);
  }
  if (typeof row.receivedAt !== 'string') {
    throw new HttpSyncTransportError('sync_receipts_invalid', 200, url);
  }
  const receipt: SyncReceipt = {
    eventId: row.eventId,
    status: row.status as SyncReceipt['status'],
    receivedAt: row.receivedAt,
  };
  if (typeof row.serverId === 'string') receipt.serverId = row.serverId;
  if (typeof row.serverVersion === 'number' && Number.isFinite(row.serverVersion)) {
    receipt.serverVersion = row.serverVersion;
  } else if (row.serverVersion !== undefined) {
    throw new HttpSyncTransportError('sync_receipts_invalid', 200, url);
  }
  if (typeof row.detail === 'string') receipt.detail = row.detail;
  return receipt;
}

function readReceipts(body: unknown, url: string): SyncReceipt[] {
  const list = Array.isArray(body)
    ? body
    : typeof body === 'object' && body !== null && Array.isArray((body as { receipts?: unknown }).receipts)
      ? (body as { receipts: unknown[] }).receipts
      : null;
  if (!list) throw new HttpSyncTransportError('sync_receipts_invalid', 200, url);
  return list.map((row) => readReceipt(row, url));
}

function readPull(body: unknown, url: string): SyncPullResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpSyncTransportError('sync_pull_invalid', 200, url);
  }
  const row = body as Record<string, unknown>;
  const resnapshot = row.resnapshotRequired === true;
  if (row.records === undefined) {
    if (!resnapshot) throw new HttpSyncTransportError('sync_pull_invalid', 200, url);
    return { records: [], resnapshotRequired: true };
  }
  if (!Array.isArray(row.records)) throw new HttpSyncTransportError('sync_pull_invalid', 200, url);
  const result: SyncPullResult = { records: row.records.slice() };
  if (resnapshot) result.resnapshotRequired = true;
  if (typeof row.cursor === 'string') result.cursor = row.cursor;
  else if (row.cursor !== undefined && row.cursor !== null) {
    throw new HttpSyncTransportError('sync_pull_invalid', 200, url);
  }
  return result;
}

/**
 * A `SyncTransport` that posts push batches and pull inputs through the
 * injected fetch. Construction does not call fetch.
 */
export function createHttpSyncTransport(options: HttpSyncTransportOptions): SyncTransport {
  return {
    async push(batch: SyncPushBatch, init?: SyncTransportInit): Promise<SyncReceipt[]> {
      const { url, parsed } = await postJson(options, HTTP_SYNC_PUSH_PATH, batch, init);
      return readReceipts(parsed, url);
    },
    async pull(input, init): Promise<SyncPullResult> {
      const wire = {
        destination: input.destination,
        limit: input.limit,
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      };
      const { url, parsed } = await postJson(options, HTTP_SYNC_PULL_PATH, wire, init);
      return readPull(parsed, url);
    },
  };
}
