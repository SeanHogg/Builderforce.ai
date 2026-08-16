/**
 * Professional references — private CRUD, plus the ONE public read.
 *
 * Everything except `GET /shared/:token` requires a signed-in person and is scoped
 * to them inside the service. The share read is public by design — an employer
 * following a link has no account here — and is therefore the only route that has
 * to reason about revocation and expiry, which `resolveShare` does.
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { ReferenceService, type ReferenceInput, type ReferenceStatus } from '../../application/career/references';

const STATUSES: readonly ReferenceStatus[] = ['draft', 'requested', 'confirmed', 'declined'];

/** Trim, cap and drop anything the client sent that is not a field we own. */
function readInput(body: Record<string, unknown>): Partial<ReferenceInput> {
  const str = (key: string, max: number): string | null | undefined => {
    const raw = body[key];
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    return String(raw).slice(0, max);
  };
  const status = body.status === undefined ? undefined
    : STATUSES.find((s) => s === body.status);
  return {
    ...(body.name !== undefined ? { name: String(body.name).slice(0, 160) } : {}),
    relationship: str('relationship', 240),
    company: str('company', 160),
    title: str('title', 160),
    email: str('email', 320),
    phone: str('phone', 60),
    canSpeakTo: str('canSpeakTo', 4000),
    notes: str('notes', 4000),
    ...(status ? { status } : {}),
  };
}

export function createReferenceRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const service = new ReferenceService(db);

  // ── The public read. Mounted BEFORE the auth middleware below. ──────────────
  router.get('/shared/:token', async (c) => {
    const view = await service.resolveShare(c.req.param('token'));
    return view ? c.json(view) : c.json({ error: 'This link is no longer available' }, 404);
  });

  router.use('*', authMiddleware);

  const userId = (c: { get: (k: string) => unknown }) => String(c.get('userId') ?? '');

  router.get('/', async (c) => c.json({ references: await service.list(userId(c)) }));

  router.post('/', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const input = readInput(body);
    if (!input.name?.trim()) return c.json({ error: 'A name is required' }, 400);
    return c.json({ reference: await service.create(userId(c), input as ReferenceInput) }, 201);
  });

  router.patch('/:id', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const updated = await service.update(userId(c), c.req.param('id'), readInput(body));
    return updated ? c.json({ reference: updated }) : c.json({ error: 'Not found' }, 404);
  });

  router.delete('/:id', async (c) => {
    const removed = await service.remove(userId(c), c.req.param('id'));
    return removed ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
  });

  // ── Shares ──────────────────────────────────────────────────────────────────
  router.get('/shares', async (c) => c.json({ shares: await service.listShares(userId(c)) }));

  router.post('/shares', async (c) => {
    // The fallback is typed, or `.catch` widens the result to a union and every
    // field read below becomes an error on the empty branch.
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));
    const referenceIds = Array.isArray(body.referenceIds) ? body.referenceIds.map(String) : [];
    if (referenceIds.length === 0) return c.json({ error: 'Choose at least one reference to share' }, 400);
    const share = await service.createShare(userId(c), {
      referenceIds,
      label: body.label === undefined ? null : String(body.label).slice(0, 160),
      includeContact: body.includeContact === true,
      expiresInDays: typeof body.expiresInDays === 'number' ? body.expiresInDays : null,
    });
    return c.json({ share }, 201);
  });

  router.post('/shares/:id/revoke', async (c) => {
    const revoked = await service.revokeShare(userId(c), c.req.param('id'));
    return revoked ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
  });

  return router;
}
