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
 * conflict) plus the storage PORT. The HTTP middleware lives in presentation
 * (`presentation/middleware/idempotentReplay.ts`); the store adapter lives in
 * infrastructure (`infrastructure/cache/idempotencyReplayStore.ts`).
 *
 * Endpoints whose writes already carry their own natural key reuse it instead of this
 * layer: chat messages (`eventKey`, `uq_brain_chat_messages_event`) and client run
 * outcomes (`clientRunId`).
 */

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
  /** `METHOD path` the key was first used with — the same key on another route is a client bug. */
  fingerprint: string;
  status: number;
  body: string;
  contentType: string | null;
}

/** Where first responses are kept, per tenant. Implementations must expire entries
 *  after {@link IDEMPOTENCY_TTL_SECONDS}. */
export interface IdempotencyStore {
  get(tenantId: number, key: string): Promise<StoredIdempotentResponse | null>;
  put(tenantId: number, key: string, response: StoredIdempotentResponse): Promise<void>;
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

/** The route identity a key is bound to. */
export function requestFingerprint(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Only a success is stored: a refused request may be corrected and sent again. */
export function isStorableStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export type ReplayDecision =
  | { kind: 'execute' }
  | { kind: 'replay'; response: StoredIdempotentResponse }
  | { kind: 'conflict' };

/** What to do with a request, given what is stored under its key. */
export function decideReplay(stored: StoredIdempotentResponse | null, fingerprint: string): ReplayDecision {
  if (!stored) return { kind: 'execute' };
  if (stored.fingerprint !== fingerprint) return { kind: 'conflict' };
  return { kind: 'replay', response: stored };
}
