/**
 * The BUYER's surface — every endpoint here is reached by somebody with no account.
 *
 * Mounted with no auth middleware, for the reason the form and signature routes already
 * record: the row each token resolves to REPORTS its tenant rather than the caller
 * asserting one. Mounting this under the authenticated tree would not make it stricter; it
 * would make the feature impossible, because the entire point is that a prospect does not
 * sign up to look at what you sent them.
 *
 * Four verbs, and no fifth. A buyer can LOOK (and be counted looking), ACCEPT, DECLINE and
 * ASK TO DRIVE. There is deliberately no edit, no comment-that-writes-a-card and no
 * upload: every one of those would be an anonymous write into a workspace, and the demo
 * this exists to serve does not need any of them.
 */

import { Hono } from 'hono';
import { isProspectEvent } from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { recordProspectEvent, resolveProspectPacket } from '../../application/sales/prospectShare';
import { acceptQuote, declineQuote, requestControl } from '../../application/sales/prospectActions';

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** A token is 64 hex characters (two joined UUIDs, hyphens stripped — see
 *  `createShareLink`). Rejected here so a malformed URL costs no database round trip. */
const TOKEN_RE = /^[0-9a-f]{64}$/i;

export function createPublicProspectRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  /** GET /:token — everything the buyer page renders. */
  r.get('/:token', async (c) => {
    const token = c.req.param('token');
    if (!TOKEN_RE.test(token)) return c.json({ error: 'Not found' }, 404);
    const packet = await resolveProspectPacket(db, token);
    // One message for "revoked", "expired", "never existed" and "wrong tenant". A public
    // endpoint that distinguishes them is one that tells a stranger which tokens are real.
    return packet ? c.json({ packet }) : c.json({ error: 'Not found' }, 404);
  });

  /**
   * POST /:token/events — "I opened it", "I looked at this card for 40 seconds".
   *
   * Returns 204 rather than a body: the buyer's browser has nothing to do with the answer,
   * and a response payload here would only invite a client to branch on it. Rate limiting
   * lives in `recordProspectEvent` (per share, per hour) because it is a property of the
   * SHARE and not of this route — the sweep and any future emitter must be bounded too.
   */
  r.post('/:token/events', async (c) => {
    const token = c.req.param('token');
    if (!TOKEN_RE.test(token)) return c.json({ error: 'Not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const event = clean(body.event, 32);
    if (!isProspectEvent(event)) return c.json({ error: 'Unknown event' }, 400);
    const recorded = await recordProspectEvent(db, c.env as Env, {
      token,
      event,
      canvasObjectId: clean(body.canvasObjectId, 64) || null,
      objectLabel: clean(body.objectLabel, 300) || null,
      seconds: Number(body.seconds ?? 0) || 0,
    });
    return recorded ? c.body(null, 204) : c.json({ error: 'Not found' }, 404);
  });

  /** POST /:token/accept — the buyer takes the deal at the price they were shown. */
  r.post('/:token/accept', async (c) => {
    const token = c.req.param('token');
    if (!TOKEN_RE.test(token)) return c.json({ error: 'Not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const quoteObjectId = clean(body.quoteObjectId, 64);
    if (!quoteObjectId) return c.json({ error: 'quoteObjectId is required' }, 400);
    const name = clean(body.name, 160);
    const email = clean(body.email, 320);
    // A name is required and an email is not: the person accepting must be identifiable,
    // and demanding a work email from somebody who has already agreed is the friction this
    // whole flow exists to remove.
    if (!name) return c.json({ error: 'Please tell us who is accepting.' }, 400);

    const result = await acceptQuote(db, c.env as Env, {
      token, quoteObjectId, acceptedByName: name, acceptedByEmail: email,
    });
    if (!result.ok) return c.json({ error: result.error, code: result.code }, result.code === 'notFound' ? 404 : 409);
    // The negotiated terms travel back to the buyer's browser so checkout opens on THIS
    // deal rather than on the public price list — the one place every discount currently
    // dies. Nothing here is trusted on the way back in: the accept route recomputed it.
    return c.json({ accepted: true, intent: result.intent, totalCents: result.totalCents, currency: result.currency });
  });

  /** POST /:token/decline — actively refused, which is different from gone quiet. */
  r.post('/:token/decline', async (c) => {
    const token = c.req.param('token');
    if (!TOKEN_RE.test(token)) return c.json({ error: 'Not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const quoteObjectId = clean(body.quoteObjectId, 64);
    if (!quoteObjectId) return c.json({ error: 'quoteObjectId is required' }, 400);
    const done = await declineQuote(db, c.env as Env, { token, quoteObjectId, reason: clean(body.reason, 600) });
    return done ? c.body(null, 204) : c.json({ error: 'Not found' }, 404);
  });

  /**
   * POST /:token/request-control — "can I try it?".
   *
   * Grants nothing. Raises the signal on the seller's live board; the seller decides.
   */
  r.post('/:token/request-control', async (c) => {
    const token = c.req.param('token');
    if (!TOKEN_RE.test(token)) return c.json({ error: 'Not found' }, 404);
    const packet = await resolveProspectPacket(db, token);
    if (!packet) return c.json({ error: 'Not found' }, 404);
    // The setting is honoured HERE and not only in the UI. A button the page hides is not
    // a control; a route that refuses is.
    if (!packet.settings.allowControlRequest) return c.json({ error: 'This link is view-only.' }, 403);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const raised = await requestControl(db, c.env as Env, {
      token,
      requestedByName: clean(body.name, 160),
      note: clean(body.note, 400),
    });
    return raised ? c.body(null, 202) : c.json({ error: 'Not found' }, 404);
  });

  return r;
}
