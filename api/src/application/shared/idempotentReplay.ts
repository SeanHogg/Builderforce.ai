/**
 * Idempotent replay — the ONE contract for "a client may send this write again".
 *
 * Offline-capable clients (the VS Code extension, the browser extension, the web app)
 * queue writes in a durable outbox and replay them when the API is reachable again. A
 * replay cannot tell whether the first attempt landed — only that no answer came back —
 * so each queued write carries an `Idempotency-Key`, and the API stores the FIRST
 * successful response per (tenant, key) and hands it back for every later attempt
 * instead of executing the write again.
 *
 * This module is the policy (key grammar, TTL, what is stored, when a replay is a
 * conflict), the storage PORT, and the factory callers use to get the platform store
 * ({@link createCacheIdempotencyStore}). The HTTP middleware lives in presentation
 * (`presentation/middleware/idempotentReplay.ts`); the cache adapter lives in
 * infrastructure (`infrastructure/cache/idempotencyReplayStore.ts`), beside its
 * sibling `reasoningReplayStore.ts`.
 *
 * Endpoints whose writes already carry their own natural key reuse it instead of this
 * layer: chat messages (`eventKey`, `uq_brain_chat_messages_event`) and client run
 * outcomes (`clientRunId`).
 */

import { cacheIdempotencyStore } from '../../infrastructure/cache/idempotencyReplayStore';
import type { CacheEnv } from '../../infrastructure/cache/readThroughCache';

/** The request header a client sends its key in. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** Set on a response that was replayed from the store rather than executed. */
export const IDEMPOTENT_REPLAY_HEADER = 'x-builderforce-idempotent-replay';

/**
 * How long a stored response answers replays. A durable outbox can hold a write for as
 * long as the client is offline, so this is a day rather than the minutes a plain HTTP
 * retry needs; past it a replay executes again (and the endpoint's own dedupe, if any,
 * is the backstop).
 */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** Longest key accepted — a UUID is 36. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/** A first response, as stored for replays. */
export interface StoredIdempotentResponse {
  /** `METHOD path` (plus a body hash on routes that bind the key to the body) the key was first
   *  used with — the same key on another route, or with another body, is a client bug. */
  fingerprint: string;
  status: number;
  body: string;
  contentType: string | null;
  /** A RESERVATION, not a response: the first request with this key is still executing. */
  pending?: true;
  /** A released reservation (its request did not succeed): the key is free again. */
  released?: true;
}

/** How long a reservation outlives its request if the request never finishes (isolate evicted). */
export const IDEMPOTENCY_PENDING_TTL_SECONDS = 60;

/** Where first responses are kept, per tenant. Implementations must expire entries
 *  after {@link IDEMPOTENCY_TTL_SECONDS} (a reservation after its own shorter `ttlSeconds`). */
export interface IdempotencyStore {
  get(tenantId: number, key: string): Promise<StoredIdempotentResponse | null>;
  put(tenantId: number, key: string, response: StoredIdempotentResponse, opts?: { ttlSeconds?: number }): Promise<void>;
}

const KEY_GRAMMAR = /^[\x21-\x7e]+$/;

/**
 * The key from the header value: trimmed, visible ASCII only, at most
 * {@link IDEMPOTENCY_KEY_MAX_LENGTH}. `null` = no header; `'invalid'` = a header that
 * cannot be a key (refused rather than silently ignored — ignoring it would turn the
 * client's replay into a duplicate write).
 */
export function parseIdempotencyKey(raw: string | undefined | null): string | null | 'invalid' {
  if (raw == null) return null;
  const key = raw.trim();
  if (key.length === 0) return null;
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH || !KEY_GRAMMAR.test(key)) return 'invalid';
  return key;
}

/** The route identity a key is bound to; with `bodyHash`, the request body too. */
export function requestFingerprint(method: string, path: string, bodyHash?: string): string {
  return `${method.toUpperCase()} ${path}${bodyHash ? ` #${bodyHash}` : ''}`;
}

/** SHA-256 (hex) of a request body, for binding a key to what was asked. */
export async function hashRequestBody(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Only a success is stored: a refused request may be corrected and sent again. */
export function isStorableStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export type ReplayDecision =
  | { kind: 'execute' }
  | { kind: 'replay'; response: StoredIdempotentResponse }
  /** The key was used for a different request (route or body): 422. */
  | { kind: 'conflict' }
  /** The first request with this key is still executing: 409, never a second execution. */
  | { kind: 'in_flight' };

/** What to do with a request, given what is stored under its key. */
export function decideReplay(stored: StoredIdempotentResponse | null, fingerprint: string): ReplayDecision {
  if (!stored || stored.released) return { kind: 'execute' };
  if (stored.fingerprint !== fingerprint) return { kind: 'conflict' };
  if (stored.pending) return { kind: 'in_flight' };
  return { kind: 'replay', response: stored };
}

/** The reservation written at the start of a request, before it executes. */
export function pendingReservation(fingerprint: string): StoredIdempotentResponse {
  return { fingerprint, status: 0, body: '', contentType: null, pending: true };
}

/** Frees a reservation whose request did not succeed, so a corrected retry executes. */
export function releasedReservation(fingerprint: string): StoredIdempotentResponse {
  return { fingerprint, status: 0, body: '', contentType: null, released: true };
}

/** The platform {@link IdempotencyStore}: the canonical read-through cache, expiring
 *  each first response after {@link IDEMPOTENCY_TTL_SECONDS}. */
export function createCacheIdempotencyStore(env: CacheEnv): IdempotencyStore {
  return cacheIdempotencyStore(env, IDEMPOTENCY_TTL_SECONDS);
}
