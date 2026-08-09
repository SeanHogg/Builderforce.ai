/**
 * The fifteen domain route groups — `/api/<domain>/…` (PRD 20 §6.3).
 *
 *   GET /api/roster                    every seat's summary, in one read
 *   GET /api/roster/team               the same roster as PEOPLE — humans and
 *                                      agents in one row shape (PRD 21 §4.1)
 *   GET /api/:domain/summary
 *   GET /api/:domain/items
 *   GET /api/:domain/activity
 *   GET /api/:domain/metrics
 *
 * "One route group per domain, each owned by one seat." Registered as ONE Hono
 * router with a `:domain` parameter validated against the roster rather than as
 * fifteen near-identical routers, for exactly the reason §0 gives for tables:
 * fifteen copies of one shape is the disease, one layer up. The per-domain
 * difference is `DOMAIN_MANIFEST` data, so adding a sixteenth seat adds a
 * manifest entry and no routing.
 *
 * An unknown `:domain` 404s here rather than falling through, so this router can
 * sit at `/api` beside the existing feature groups without shadowing them.
 *
 * Depends on the `DomainService` port, never on `src/infrastructure` — see the
 * note in `objectRoutes.ts` on why a new file must not join the layering baseline.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { scope } from './segmentTrackerRoutes';
import { isDomain, type Domain } from '../../application/kernel/ObjectRegistry';
import type { DomainService } from '../../application/kernel/DomainService';
import type { TeamRosterService } from '../../application/kernel/TeamRoster';
import { EntityError, type EntityService } from '../../application/domains/EntityService';
import { isEntityScope, type EntityScope } from '../../application/domains/entityDefinition';
import type { HonoEnv } from '../../env';

function parseLimit(raw: string | undefined): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

function parseOffset(raw: string | undefined): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

export function createDomainRoutes(
  domains: DomainService,
  entities: EntityService,
  team: TeamRosterService,
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /**
   * The entity layer's one failure translation.
   *
   * `EntityService` throws `EntityError` with the status it means, so the
   * mapping from a rejected input to a status code exists ONCE rather than in
   * each of the five handlers below — and an unexpected error is never
   * flattened into a 400 that hides it.
   */
  const handle = async (run: () => Promise<Response>): Promise<Response> => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof EntityError) {
        return Response.json({ error: err.message, detail: err.detail ?? null }, { status: err.status });
      }
      throw err;
    }
  };

  /** Entity endpoints answer for the fifteen seats AND for the kernel's shared
   *  primitives, which belong to no seat (§2) — so they validate against the
   *  scope list rather than the roster. */
  const resolveScope = (raw: string): EntityScope | null => (isEntityScope(raw) ? raw : null);

  /** Who is writing. Taken from the session, never from the body — the same rule
   *  the tenant id follows one layer down. */
  const actorOf = (c: Context<HonoEnv>) => ({
    userId: c.get('userId') ?? null,
    machine: Boolean(c.get('machineActor')),
  });

  /**
   * The roster.
   *
   * Every seat is listed, always — progressive disclosure gates STATE, never
   * capability (§7). `rung` travels with each row so the surface can dim what is
   * not yet earned instead of hiding it, and so that decision is made in ONE
   * place rather than re-derived per consumer.
   */
  router.get('/roster', async (c) => {
    const { tenantId } = scope(c);
    return c.json(await domains.roster(tenantId));
  });

  /** The roster's static shape, for a surface that has no tenant yet — the
   *  logged-out public catalogue is the same list read through another shell. */
  router.get('/roster/manifest', (c) => c.json(domains.manifest()));

  /**
   * The roster in its PEOPLE form — the ONE endpoint the footer, the presence
   * pile and the canvas drop target read (PRD 21 §4.1).
   *
   * Humans and agents come back in one row shape with a `kind` discriminator, so
   * both cards become renderers of one row rather than two lists a consumer has
   * to merge (and get subtly different). A seat with nothing provisioned behind
   * it is returned `locked` rather than omitted — disable, never hide.
   */
  router.get('/roster/team', async (c) => {
    const { tenantId } = scope(c);
    return c.json({ members: await team.list(tenantId) });
  });

  /** Resolve and validate `:domain` once, rather than in each handler. */
  const resolve = (raw: string): Domain | null => (isDomain(raw) ? raw : null);

  router.get('/:domain/summary', async (c) => {
    const domain = resolve(c.req.param('domain'));
    if (!domain) return c.json({ error: 'unknown domain' }, 404);
    const { tenantId } = scope(c);
    return c.json(await domains.summary(tenantId, domain));
  });

  router.get('/:domain/items', async (c) => {
    const domain = resolve(c.req.param('domain'));
    if (!domain) return c.json({ error: 'unknown domain' }, 404);
    const { tenantId } = scope(c);
    return c.json(
      await domains.items(tenantId, domain, {
        kind: c.req.query('kind'),
        limit: parseLimit(c.req.query('limit')),
      }),
    );
  });

  router.get('/:domain/activity', async (c) => {
    const domain = resolve(c.req.param('domain'));
    if (!domain) return c.json({ error: 'unknown domain' }, 404);
    const { tenantId } = scope(c);
    return c.json(
      await domains.activity(tenantId, domain, parseLimit(c.req.query('limit'))),
    );
  });

  router.get('/:domain/metrics', async (c) => {
    const domain = resolve(c.req.param('domain'));
    if (!domain) return c.json({ error: 'unknown domain' }, 404);
    const { tenantId } = scope(c);
    const days = Number(c.req.query('days'));
    return c.json(
      await domains.metrics(tenantId, domain, Number.isFinite(days) ? days : 30),
    );
  });

  // ── the entity layer ───────────────────────────────────────────────────────
  //
  // `/api/<scope>/entities/...` is what gives the 244 consolidated tables a code
  // path (§5). ONE set of five handlers, because the use cases are identical
  // across every table and the per-table difference is the catalog's definition
  // — the same argument §0 makes about the schema, at the routing layer.

  /** The shapes this seat owns, with a row count each. Metadata and counts in
   *  one response so a surface renders its tab strip in a single request rather
   *  than one per entity. */
  router.get('/:domain/entities', async (c) => {
    const target = resolveScope(c.req.param('domain'));
    if (!target) return c.json({ error: 'unknown scope' }, 404);
    const { tenantId } = scope(c);
    const [described, counts] = await Promise.all([
      Promise.resolve(entities.describe(target)),
      entities.counts(tenantId, target),
    ]);
    return c.json(described.map((d) => ({ ...d, count: counts[d.name] ?? 0 })));
  });

  router.get('/:domain/entities/:entity', async (c) => {
    const target = resolveScope(c.req.param('domain'));
    if (!target) return c.json({ error: 'unknown scope' }, 404);
    const { tenantId } = scope(c);
    return handle(async () =>
      Response.json(
        await entities.list(tenantId, target, c.req.param('entity'), {
          limit: parseLimit(c.req.query('limit')),
          offset: parseOffset(c.req.query('offset')),
          q: c.req.query('q'),
          includeArchived: c.req.query('archived') === 'true',
        }),
      ),
    );
  });

  router.post('/:domain/entities/:entity', async (c) => {
    const target = resolveScope(c.req.param('domain'));
    if (!target) return c.json({ error: 'unknown scope' }, 404);
    const { tenantId } = scope(c);
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'body must be an object' }, 400);
    return handle(async () =>
      Response.json(
        await entities.create(tenantId, target, c.req.param('entity'), body, actorOf(c)),
        { status: 201 },
      ),
    );
  });

  router.get('/:domain/entities/:entity/:id', async (c) => {
    const target = resolveScope(c.req.param('domain'));
    if (!target) return c.json({ error: 'unknown scope' }, 404);
    const { tenantId } = scope(c);
    return handle(async () => {
      const row = await entities.get(tenantId, target, c.req.param('entity'), c.req.param('id'));
      return row ? Response.json(row) : Response.json({ error: 'not found' }, { status: 404 });
    });
  });

  router.patch('/:domain/entities/:entity/:id', async (c) => {
    const target = resolveScope(c.req.param('domain'));
    if (!target) return c.json({ error: 'unknown scope' }, 404);
    const { tenantId } = scope(c);
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'body must be an object' }, 400);
    return handle(async () =>
      Response.json(
        await entities.update(tenantId, target, c.req.param('entity'), c.req.param('id'), body, actorOf(c)),
      ),
    );
  });

  router.delete('/:domain/entities/:entity/:id', async (c) => {
    const target = resolveScope(c.req.param('domain'));
    if (!target) return c.json({ error: 'unknown scope' }, 404);
    const { tenantId } = scope(c);
    return handle(async () =>
      Response.json(
        await entities.archive(tenantId, target, c.req.param('entity'), c.req.param('id'), actorOf(c)),
      ),
    );
  });

  return router;
}
