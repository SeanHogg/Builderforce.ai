import { Hono } from 'hono';
import { REPLAY_LIMITS } from '@builderforce/interaction-contract';
import type { HonoEnv } from '../../env';
import type { DbHandle } from '../../application/shared/dbHandle';
import { ReplayConfigService } from '../../application/replay/ReplayConfigService';
import { ReplayIngestService } from '../../application/replay/ReplayIngestService';

/**
 * The PUBLIC Insights ingest (PRD 33 §3.3, §3.5) — `/api/replay-ingest`.
 *
 *   GET  /v1/config?site=<bfr_…|hosted:<siteId>>   the loader's config
 *   POST /v1/chunks?site=<…>                         one gzip chunk → ALWAYS 202 {ok:true}
 *
 * Unauthenticated by necessity: it runs on customers' pages. The site token plus the
 * request's Origin is the whole credential (origin-bound, resolved in the
 * application layer), and the path is in cors.ts's PUBLIC_INGEST_PREFIXES so any
 * origin may reach it. The chunk answer never varies with the outcome — ingest never
 * says why it dropped a chunk (§6).
 *
 * The site token rides in the query string because a `sendBeacon` can set neither
 * headers nor credentials.
 *
 * A chunk whose declared `Content-Length` is over `REPLAY_LIMITS.maxChunkBytes` is
 * answered (the same 202) BEFORE its body is buffered: nothing is read or written,
 * so an oversized post costs the worker no memory. The service still enforces the
 * limit on the bytes for a body sent without a length (chunked transfer).
 */

/** `cf.country`, when the runtime supplies it. */
function countryOf(raw: Request): string | null {
  const cf = (raw as Request & { cf?: { country?: unknown } }).cf;
  return typeof cf?.country === 'string' && /^[A-Z]{2}$/.test(cf.country) ? cf.country : null;
}

export function createReplayIngestRoutes(db: DbHandle): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/v1/config', async (c) => {
    const config = await new ReplayConfigService(c.env, db).config(c.req.query('site') ?? null, c.req.header('Origin') ?? null);
    c.header('Cache-Control', 'no-store');
    return c.json(config);
  });

  router.post('/v1/chunks', async (c) => {
    const declared = Number(c.req.header('Content-Length'));
    if (Number.isFinite(declared) && declared > REPLAY_LIMITS.maxChunkBytes) return c.json({ ok: true }, 202);
    let body: ArrayBuffer;
    try {
      body = await c.req.arrayBuffer();
    } catch {
      // An aborted beacon has no body; it is answered like every other chunk.
      return c.json({ ok: true }, 202);
    }
    await new ReplayIngestService(c.env, db).ingest({
      siteToken: c.req.query('site') ?? null,
      origin: c.req.header('Origin') ?? null,
      ip: c.req.header('cf-connecting-ip') ?? null,
      country: countryOf(c.req.raw),
      contentEncoding: c.req.header('Content-Encoding') ?? null,
      body,
    });
    return c.json({ ok: true }, 202);
  });

  return router;
}
