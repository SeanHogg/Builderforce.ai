/**
 * The kernel route group — `/api/objects` (PRD 20 §6.3).
 *
 *   GET    /api/objects/:id                    resolve any addressable thing
 *   GET    /api/objects/:id/trail              breadcrumb, root first
 *   GET    /api/objects/:id/activity           ONE timeline, not one per subsystem
 *   GET    /api/objects/:id/annotations        comments, notes, tags, likes, votes
 *   POST   /api/objects/:id/annotations
 *   GET    /api/objects/:id/members
 *   POST   /api/objects/:id/members
 *   DELETE /api/objects/:id/members/:kind/:ref
 *   GET    /api/objects/:id/shares
 *   POST   /api/objects/:id/shares             returns the raw token ONCE
 *   DELETE /api/objects/:id/shares/:shareId    THE revocation path
 *   GET    /api/objects/:id/revisions
 *   POST   /api/objects/:id/revisions
 *   GET    /api/objects/recents                derived, never a stored list
 *
 * Every one of these exists today between six and forty times under different
 * names. This is the group that replaces them.
 *
 * LAYER CONTRACT (§6.1). Presentation: parse, authorise, call ONE application
 * service, serialise. No SQL, no table names, and — unlike the 144 route files
 * `check-layering.mjs` still has on its baseline — no import from
 * `src/infrastructure` at all. It takes the `ObjectRegistry` port; `src/index.ts`
 * binds the connection to it. §5 step 6's exit criterion is that baseline at
 * zero, so a new file joining it would be moving the wrong way.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { scope } from './segmentTrackerRoutes';
import { isDomain, type ObjectRegistry } from '../../application/kernel/ObjectRegistry';
import type { HonoEnv } from '../../env';

/** Clamp a `?limit=`. The application layer clamps again — this one is so a
 *  nonsense query string never reaches it, that one is so a non-HTTP caller
 *  cannot skip the bound. */
function parseLimit(raw: string | undefined): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

export function createObjectRoutes(registry: ObjectRegistry): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /**
   * Recents — "what did I touch".
   *
   * Registered BEFORE `/:id` so the literal path is not swallowed by the
   * parameter. Derived from `objects` + `activity_log`, never a stored list
   * (§7): one query answers it, where today it would need a union across thirty
   * tables and would silently miss the thirty-first.
   */
  router.get('/recents', async (c) => {
    const { tenantId } = scope(c);
    const actorRef = c.get('userId') as string | undefined;
    if (!actorRef) return c.json({ error: 'unauthenticated' }, 401);
    const domainParam = c.req.query('domain');
    if (domainParam && !isDomain(domainParam)) return c.json({ error: 'unknown domain' }, 400);
    return c.json(
      await registry.recents(tenantId, actorRef, {
        domain: domainParam && isDomain(domainParam) ? domainParam : undefined,
        limit: parseLimit(c.req.query('limit')),
      }),
    );
  });

  router.get('/:id', async (c) => {
    const { tenantId } = scope(c);
    const row = await registry.get(tenantId, c.req.param('id'));
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  router.get('/:id/trail', async (c) => {
    const { tenantId } = scope(c);
    return c.json(await registry.trail(tenantId, c.req.param('id')));
  });

  // ── activity ─────────────────────────────────────────────────────────────

  router.get('/:id/activity', async (c) => {
    const { tenantId } = scope(c);
    return c.json(
      await registry.activity(tenantId, c.req.param('id'), parseLimit(c.req.query('limit'))),
    );
  });

  // ── annotations ──────────────────────────────────────────────────────────

  router.get('/:id/annotations', async (c) => {
    const { tenantId } = scope(c);
    return c.json(
      await registry.annotations(tenantId, c.req.param('id'), {
        kind: c.req.query('kind'),
        limit: parseLimit(c.req.query('limit')),
      }),
    );
  });

  router.post('/:id/annotations', async (c) => {
    const { tenantId } = scope(c);
    const objectId = c.req.param('id');
    // 404 before writing: an annotation on an unregistered object would be an
    // orphan, which is the exact failure the registry exists to prevent.
    if (!(await registry.get(tenantId, objectId))) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<{
      kind?: string; body?: string; value?: string; label?: string; anchor?: unknown; parentId?: number;
    }>();
    const row = await registry.addAnnotation({
      tenantId,
      objectId,
      kind: body.kind,
      authorKind: 'user',
      authorRef: (c.get('userId') as string | undefined) ?? null,
      body: body.body ?? null,
      value: body.value ?? null,
      label: body.label ?? null,
      anchor: body.anchor,
      parentId: body.parentId ?? null,
    });
    return c.json(row, 201);
  });

  // ── members ──────────────────────────────────────────────────────────────

  router.get('/:id/members', async (c) => {
    const { tenantId } = scope(c);
    return c.json(
      await registry.members(tenantId, c.req.param('id'), parseLimit(c.req.query('limit'))),
    );
  });

  router.post('/:id/members', async (c) => {
    const { tenantId } = scope(c);
    const objectId = c.req.param('id');
    if (!(await registry.get(tenantId, objectId))) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<{ memberKind?: string; memberRef?: string; role?: string }>();
    if (!body.memberRef) return c.json({ error: 'memberRef is required' }, 400);
    const row = await registry.addMember({
      tenantId,
      objectId,
      memberKind: body.memberKind ?? 'user',
      memberRef: body.memberRef,
      role: body.role,
    });
    return c.json(row, 201);
  });

  router.delete('/:id/members/:kind/:ref', async (c) => {
    const { tenantId } = scope(c);
    await registry.removeMember({
      tenantId,
      objectId: c.req.param('id'),
      memberKind: c.req.param('kind'),
      memberRef: c.req.param('ref'),
    });
    return c.body(null, 204);
  });

  // ── shares ───────────────────────────────────────────────────────────────

  router.get('/:id/shares', async (c) => {
    const { tenantId } = scope(c);
    return c.json(await registry.shares(tenantId, c.req.param('id')));
  });

  router.post('/:id/shares', async (c) => {
    const { tenantId } = scope(c);
    const objectId = c.req.param('id');
    if (!(await registry.get(tenantId, objectId))) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<{ scope?: 'view' | 'comment' | 'edit'; expiresAt?: string; maxUses?: number }>();
    const created = await registry.createShare({
      tenantId,
      objectId,
      scope: body.scope,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      maxUses: body.maxUses ?? null,
      createdBy: (c.get('userId') as string | undefined) ?? null,
    });
    // The raw token is returned exactly once. Only its hash was stored.
    return c.json(created, 201);
  });

  router.delete('/:id/shares/:shareId', async (c) => {
    const { tenantId } = scope(c);
    await registry.revokeShare(tenantId, c.req.param('id'), c.req.param('shareId'));
    return c.body(null, 204);
  });

  // ── revisions ────────────────────────────────────────────────────────────

  router.get('/:id/revisions', async (c) => {
    const { tenantId } = scope(c);
    return c.json(
      await registry.revisions(tenantId, c.req.param('id'), parseLimit(c.req.query('limit'))),
    );
  });

  router.post('/:id/revisions', async (c) => {
    const { tenantId } = scope(c);
    const objectId = c.req.param('id');
    if (!(await registry.get(tenantId, objectId))) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<{
      label?: string; summary?: string; patch?: unknown; snapshotKey?: string; byteSize?: number;
    }>();
    const row = await registry.recordRevision({
      tenantId,
      objectId,
      label: body.label ?? null,
      authorRef: (c.get('userId') as string | undefined) ?? null,
      summary: body.summary ?? null,
      patch: body.patch,
      snapshotKey: body.snapshotKey ?? null,
      byteSize: body.byteSize ?? null,
    });
    return c.json(row, 201);
  });

  return router;
}
