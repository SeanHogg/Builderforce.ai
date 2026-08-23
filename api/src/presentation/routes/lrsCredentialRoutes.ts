/**
 * LRS credentials — mounted under /api/learning
 *
 *   GET    /lrs/credentials        → every key, both directions; no secrets
 *   POST   /lrs/credentials        → issue an inbound key; the secret is shown ONCE
 *   POST   /lrs/targets            → register an external LRS to forward to
 *   DELETE /lrs/credentials/:id    → revoke
 *
 * ── WHY THIS IS A SEPARATE ROUTER FROM `lrsRoutes` ──────────────────────────
 * Different authentication, different audience, different reason to change. That
 * router IS the xAPI standard, spoken to authoring tools over Basic auth against
 * a fixed prefix; this one is a settings screen for a signed-in administrator.
 * Putting them together would mean one module where half the handlers must never
 * see a session and the other half must always have one.
 *
 * It shares `/api/learning` with `learningRoutes` — Hono merges routers on a
 * prefix — because a caller should not have to know that "the paths API" and "the
 * LRS keys API" were written separately.
 *
 * ── THE SECRET IS RETURNED ONCE ─────────────────────────────────────────────
 * `issueInboundCredential` seals it on the way in and there is no read path back.
 * That is a property of the store rather than a rule this route enforces, which is
 * the only version of "we cannot recover it" worth telling a customer.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import {
  issueInboundCredential, listLrsCredentials, registerOutboundTarget, revokeLrsCredential,
} from '../../application/learning/lrsCredentials';

export function createLrsCredentialRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  // Manager throughout: a key minted here can write into the workspace's learning
  // record from outside it, which is not a viewer-level act in either direction.
  const manager = requireRole(TenantRole.MANAGER);

  r.use('*', authMiddleware);

  const ctx = (c: { env: unknown; get: (key: string) => unknown }) => ({
    env: c.env as Env,
    tenantId: c.get('tenantId') as number,
    userId: c.get('userId') as string,
  });

  r.get('/lrs/credentials', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    return c.json({ credentials: await listLrsCredentials(db, env, tenantId) });
  });

  r.post('/lrs/credentials', manager, async (c) => {
    const { env, tenantId, userId } = ctx(c);
    const body = await c.req.json().catch(() => ({})) as { label?: string };

    const result = await issueInboundCredential(db, env, {
      tenantId, userId, label: (body.label ?? '').trim(),
    });
    return c.json({ credential: result.credential, secret: result.secret }, 201);
  });

  r.post('/lrs/targets', manager, async (c) => {
    const { env, tenantId, userId } = ctx(c);
    const body = await c.req.json().catch(() => ({})) as {
      label?: string; endpoint?: string; key?: string; secret?: string;
    };

    const endpoint = (body.endpoint ?? '').trim();
    const key = (body.key ?? '').trim();
    const secret = (body.secret ?? '').trim();
    if (!endpoint || !key || !secret) {
      return c.json({ error: 'A forwarding target needs its endpoint, key and secret.' }, 400);
    }

    const result = await registerOutboundTarget(db, env, {
      tenantId, userId, label: (body.label ?? '').trim(), endpoint, key, secret,
    });
    if (!result.ok) return c.json({ error: result.detail, reason: result.reason }, 400);
    return c.json({ credential: result.credential }, 201);
  });

  r.delete('/lrs/credentials/:id', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Unknown credential.' }, 404);

    const result = await revokeLrsCredential(db, env, tenantId, id);
    if (!result.ok) return c.json({ error: result.detail }, 404);
    return c.json({ revoked: true });
  });

  return r;
}
