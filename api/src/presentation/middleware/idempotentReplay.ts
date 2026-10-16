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
  decideReplay,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAY_HEADER,
  isStorableStatus,
  parseIdempotencyKey,
  requestFingerprint,
  type IdempotencyStore,
  type StoredIdempotentResponse,
} from '../../application/shared/idempotentReplay';
import { deferPastResponse } from '../../application/shared/requestScope';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { createCacheIdempotencyStore } from '../../application/shared/idempotencyReplayStore';

const SOURCE = 'presentation/middleware/idempotentReplay.ts';

export interface IdempotentReplayOptions {
  /** The calling tenant. Default: `tenantId` set by the route's auth middleware. A route
   *  that authenticates inside its handler passes its own resolver. `null` = unknown
   *  caller: the request runs unguarded and the handler answers it (401). */
  tenantOf?(c: Context<HonoEnv>): number | null | Promise<number | null>;
  /** Override the store (tests). */
  store?(c: Context<HonoEnv>): IdempotencyStore;
}

const tenantFromAuth = (c: Context<HonoEnv>): number | null => {
  const tenantId: unknown = c.get('tenantId');
  return typeof tenantId === 'number' ? tenantId : null;
};

export function idempotentReplay(opts: IdempotentReplayOptions = {}): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const key = parseIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER));
    if (key === null) return next();
    if (key === 'invalid') {
      return c.json({ error: `${IDEMPOTENCY_KEY_HEADER} must be 1-128 visible ASCII characters`, code: 'idempotency_key_invalid' }, 400);
    }
    const tenantId = await (opts.tenantOf ?? tenantFromAuth)(c);
    if (tenantId === null) return next();

    const store = opts.store ? opts.store(c) : createCacheIdempotencyStore(c.env as Env);
    const fingerprint = requestFingerprint(c.req.method, c.req.path);

    let stored: StoredIdempotentResponse | null = null;
    try {
      stored = await store.get(tenantId, key);
    } catch (error) {
      // A store outage degrades to "execute": the endpoint's own dedupe is the backstop.
      reportCaughtError(error, { source: SOURCE, operation: 'idempotentReplay.get' });
    }
    const decision = decideReplay(stored, fingerprint);
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
  };
}
