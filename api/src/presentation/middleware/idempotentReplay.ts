/**
 * `Idempotency-Key` for the writes offline clients replay.
 *
 * Mount it on a route AFTER its authentication (it scopes keys by tenant):
 *
 *   router.post('/ingest', authMiddleware, idempotentReplay(), handler)
 *
 * With no header the request runs as it always did. With a key, the first 2xx response
 * is stored per (tenant, key) for a day and every later request with that key gets it
 * back verbatim — flagged `x-builderforce-idempotent-replay: true` — without the handler
 * running again. The same key on a different route is a client bug and answers 422.
 *
 * The policy lives in `application/shared/idempotentReplay.ts`; storage is the canonical
 * read-through cache behind the {@link IdempotencyStore} port.
 */

import type { Context, MiddlewareHandler } from 'hono';

import type { Env, HonoEnv } from '../../env';
import {
  createCacheIdempotencyStore,
  decideReplay,
  hashRequestBody,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_PENDING_TTL_SECONDS,
  pendingReservation,
  releasedReservation,
  IDEMPOTENT_REPLAY_HEADER,
  isStorableStatus,
  parseIdempotencyKey,
  requestFingerprint,
  type IdempotencyStore,
  type StoredIdempotentResponse,
} from '../../application/shared/idempotentReplay';
import { deferPastResponse } from '../../application/shared/requestScope';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

const SOURCE = 'presentation/middleware/idempotentReplay.ts';

export interface IdempotentReplayOptions<E extends HonoEnv = HonoEnv> {
  /** The calling tenant. Default: `tenantId` set by the route's auth middleware. A route
   *  that authenticates inside its handler passes its own resolver. `null` = unknown
   *  caller: the request runs unguarded and the handler answers it (401). */
  tenantOf?(c: Context<E>): number | null | Promise<number | null>;
  /** Override the store (tests). */
  store?(c: Context<E>): IdempotencyStore;
  /** Bind the key to the request BODY as well as the route: reusing a key with a different
   *  body answers 422. For writes whose body decides what runs (`/executions`, `/tasks/submit`). */
  bindBody?: boolean;
}

/** Keys whose first request is executing in THIS isolate - taken synchronously, so two
 *  requests racing into one isolate cannot both pass. The store reservation covers the rest. */
const IN_FLIGHT = new Set<string>();

const inFlightResponse = <E extends HonoEnv>(c: Context<E>, key: string): Response => c.json({
  error: `A request with ${IDEMPOTENCY_KEY_HEADER} '${key}' is still being processed. Retry shortly to receive its result.`,
  code: 'idempotency_request_in_flight',
}, 409);

const tenantFromAuth = <E extends HonoEnv>(c: Context<E>): number | null => {
  const tenantId: unknown = c.get('tenantId');
  return typeof tenantId === 'number' ? tenantId : null;
};

/** Generic over the route's env so a router with wider Bindings (e.g. the runtime router's Durable Object namespace) mounts it without a cast. */
export function idempotentReplay<E extends HonoEnv = HonoEnv>(opts: IdempotentReplayOptions<E> = {}): MiddlewareHandler<E> {
  return async (c, next) => {
    const key = parseIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER));
    if (key === null) return next();
    if (key === 'invalid') {
      return c.json({ error: `${IDEMPOTENCY_KEY_HEADER} must be 1-128 visible ASCII characters`, code: 'idempotency_key_invalid' }, 400);
    }
    const tenantId = await (opts.tenantOf ?? tenantFromAuth)(c);
    if (tenantId === null) return next();

    // Take the same-isolate slot BEFORE any await (see IN_FLIGHT).
    const slot = `${tenantId}:${key}`;
    if (IN_FLIGHT.has(slot)) return inFlightResponse(c, key);
    IN_FLIGHT.add(slot);
    let reservedFingerprint: string | null = null;
    const store = opts.store ? opts.store(c) : createCacheIdempotencyStore(c.env as Env);
    try {
      const bodyHash = opts.bindBody ? await hashRequestBody(await c.req.raw.clone().text()) : undefined;
      const fingerprint = requestFingerprint(c.req.method, c.req.path, bodyHash);

      let stored: StoredIdempotentResponse | null = null;
      try {
        stored = await store.get(tenantId, key);
      } catch (error) {
        // A store outage degrades to "execute": the endpoint's own dedupe is the backstop.
        reportCaughtError(error, { source: SOURCE, operation: 'idempotentReplay.get' });
      }
      const decision = decideReplay(stored, fingerprint);
      if (decision.kind === 'in_flight') return inFlightResponse(c, key);
      if (decision.kind === 'replay') {
        const headers = new Headers({ [IDEMPOTENT_REPLAY_HEADER]: 'true' });
        if (decision.response.contentType) headers.set('content-type', decision.response.contentType);
        return new Response(decision.response.body, { status: decision.response.status, headers });
      }
      if (decision.kind === 'conflict') {
        return c.json({
          error: `${IDEMPOTENCY_KEY_HEADER} '${key}' was already used for a different request`,
          code: 'idempotency_key_reused',
        }, 422);
      }

      // Reserve the key in the shared store so a second request on ANOTHER isolate sees
      // "in flight" instead of executing again. Short TTL: an evicted isolate frees it.
      try {
        await store.put(tenantId, key, pendingReservation(fingerprint), { ttlSeconds: IDEMPOTENCY_PENDING_TTL_SECONDS });
        reservedFingerprint = fingerprint;
      } catch (error) {
        reportCaughtError(error, { source: SOURCE, operation: 'idempotentReplay.reserve' });
      }

      await next();

      const status = c.res.status;
      if (!isStorableStatus(status)) return;
      const res = c.res.clone();
      const write = res.text()
        .then((body) => store.put(tenantId, key, {
          fingerprint,
          status,
          body,
          contentType: res.headers.get('content-type'),
        }))
        .catch((error: unknown) => {
          reportCaughtError(error, { source: SOURCE, operation: 'idempotentReplay.put' });
        });
      // Recorded past the response where the runtime allows it; awaited otherwise.
      if (!deferPastResponse(write)) await write;
      reservedFingerprint = null; // replaced by the stored response
    } finally {
      IN_FLIGHT.delete(slot);
      // A request that did not succeed releases its reservation so a corrected retry runs.
      if (reservedFingerprint !== null) {
        await store.put(tenantId, key, releasedReservation(reservedFingerprint), { ttlSeconds: IDEMPOTENCY_PENDING_TTL_SECONDS })
          .catch((error: unknown) => reportCaughtError(error, { source: SOURCE, operation: 'idempotentReplay.release' }));
      }
    }
  };
}
