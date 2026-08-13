/**
 * Candidate self-scheduling — /api/booking/*  (PUBLIC, token-scoped)
 *
 *   GET  /:token          — the slots this link offers, and whether it is already booked.
 *   POST /:token/book     — book one of them.
 *
 * ── WHY THIS IS SESSION-FREE ─────────────────────────────────────────────────────
 * The person using it is a candidate. They have no account, they should not be asked to
 * make one to pick a time, and requiring a session is exactly what has kept interview
 * scheduling a manual email thread while a correct availability solver sat in the
 * codebase with one internal consumer.
 *
 * Authorization is the token, and the token is narrow by construction: it resolves to
 * ONE interview, it can only read that interview's offered slots, and the only write it
 * permits is choosing one of those slots. It cannot enumerate, cannot reach another
 * tenant, and returns nothing identifying — no candidate name, no interviewer names, no
 * job title. A leaked link discloses a set of times.
 *
 * ── WHY THE PANEL REFS ARE READ SERVER-SIDE ──────────────────────────────────────
 * The re-check at booking needs the interviewers' calendars, and the candidate must
 * never be told who they are. So the refs are resolved here from the interview's kit
 * stage, never accepted from the request — a client-supplied panel would let a caller
 * book against an empty panel and skip the availability check entirely.
 */
import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv, Env } from '../../env';
import {
  bookInterviewSlot, interviewPanelRefs, interviewTenantId, readBookingOffer,
} from '../../application/hiring/interviewScheduling';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

/**
 * A booking token is 64 hex characters. Checking the SHAPE before touching the database
 * turns a scan for valid tokens into a request that never reaches Postgres.
 */
const TOKEN_RE = /^[0-9a-f]{32,128}$/i;

export function createCandidateBookingRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  r.get('/:token', async (c) => {
    const token = c.req.param('token');
    // One shape of answer for "no such token", "expired", "revoked" and "used up": a
    // distinguishable response would let a caller sort guessed tokens into interesting
    // and uninteresting.
    if (!TOKEN_RE.test(token)) return c.json({ error: 'This booking link is no longer valid.' }, 404);
    try {
      const offer = await readBookingOffer(db, token);
      if (!offer) return c.json({ error: 'This booking link is no longer valid.' }, 404);
      return c.json({
        slots: offer.slots,
        durationMinutes: offer.durationMinutes,
        timezone: offer.candidateTimezone,
        booked: Boolean(offer.bookedAt),
        bookedAt: offer.bookedAt,
        expiresAt: offer.expiresAt,
      });
    } catch (error) {
      reportCaughtError(error, { source: 'candidateBooking', operation: 'read' });
      return c.json({ error: 'Could not load this booking link.' }, 500);
    }
  });

  r.post('/:token/book', async (c) => {
    const token = c.req.param('token');
    if (!TOKEN_RE.test(token)) return c.json({ error: 'This booking link is no longer valid.' }, 404);
    let startISO = '';
    try {
      const body = await c.req.json<{ startISO?: unknown }>();
      startISO = typeof body?.startISO === 'string' ? body.startISO : '';
    } catch {
      return c.json({ error: 'Choose a time.' }, 400);
    }
    if (!startISO) return c.json({ error: 'Choose a time.' }, 400);

    try {
      const offer = await readBookingOffer(db, token);
      if (!offer) return c.json({ error: 'This booking link is no longer valid.' }, 404);

      const tenantId = await interviewTenantId(db, offer.interviewId);
      const refs = tenantId ? await interviewPanelRefs(db, tenantId, offer.interviewId) : [];

      const result = await bookInterviewSlot(db, c.env as Env, token, startISO, refs);
      if (!result.ok) {
        // 409 for a slot that is gone, 400 for a time that was never on offer: the first
        // means "try another", the second means the client is out of step with the offer
        // and should reload.
        return c.json({ error: result.error, code: result.code }, result.code === 'not-offered' ? 400 : 409);
      }
      return c.json({ booked: true, scheduledAt: result.scheduledAt });
    } catch (error) {
      reportCaughtError(error, { source: 'candidateBooking', operation: 'book' });
      return c.json({ error: 'Could not complete the booking.' }, 500);
    }
  });

  return r;
}
