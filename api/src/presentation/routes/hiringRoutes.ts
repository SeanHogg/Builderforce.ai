/**
 * Recruiter surface — /api/hiring/*
 *
 *   GET  /funnel                    — stage conversion, time-in-stage, source-of-hire.
 *   POST /interviews/:id/offer-slots — mint a candidate self-schedule link.
 *   POST /candidates/:ref/consent    — record the lawful basis and the retention clock.
 *   POST /candidates/:ref/erase      — honour an erasure request.
 *   GET  /diversity                  — EEO counts, WITHOUT identifiers.
 *
 * ── WHY A THIN ROUTE ─────────────────────────────────────────────────────────────
 * Every one of these is an application call and a shape check. The funnel arithmetic is
 * in `application/hiring/hiringFunnel.ts` because the canvas reads it too; the booking
 * flow is in `application/hiring/interviewScheduling.ts` because the PUBLIC candidate
 * route reads the other half of it. A route that owned either would make the second
 * consumer a copy — which is how the availability solver came to have one consumer and
 * candidate scheduling came to have none.
 */
import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv, Env } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import { hiringFunnel, invalidateHiringFunnel } from '../../application/hiring/hiringFunnel';
import { interviewPanelRefs, offerInterviewSlots } from '../../application/hiring/interviewScheduling';
import {
  candidateDiversityReport, eraseCandidateRecord, isLawfulBasis, isRetentionBasis,
  recordCandidateConsent, LAWFUL_BASES, RETENTION_BASES,
} from '../../application/hiring/candidateRecords';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

export function createHiringRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  r.use('*', authMiddleware);

  const scope = (c: { get: (key: 'tenantId') => number | undefined }) => c.get('tenantId') ?? 0;

  // GET /funnel?pipelineRef=&days=
  r.get('/funnel', async (c) => {
    const tenantId = scope(c as never);
    const pipelineRef = c.req.query('pipelineRef') || null;
    const days = Number(c.req.query('days') ?? 90);
    try {
      return c.json(await hiringFunnel(c.env as Env, db, tenantId, { pipelineRef, days }));
    } catch (error) {
      reportCaughtError(error, { source: 'hiringRoutes', operation: 'funnel' });
      return c.json({ error: 'Could not compute the funnel.' }, 500);
    }
  });

  // POST /interviews/:id/offer-slots — mint the candidate's self-schedule link.
  r.post('/interviews/:id/offer-slots', async (c) => {
    const tenantId = scope(c as never);
    const interviewId = Number(c.req.param('id'));
    if (!Number.isInteger(interviewId)) return c.json({ error: 'Unknown interview.' }, 400);

    const body = await c.req.json<{
      durationMinutes?: unknown; candidateTimezone?: unknown;
      from?: unknown; to?: unknown; count?: unknown; linkDays?: unknown;
    }>().catch(() => ({} as Record<string, unknown>));

    // The panel comes from the interview's kit stage, never from the request — the same
    // rule the public booking route follows, for the same reason: a client-supplied
    // panel is a client-supplied availability check.
    const panelRefs = await interviewPanelRefs(db, tenantId, interviewId);
    if (!panelRefs.length) {
      return c.json({ error: 'This interview stage names no interviewers, so there are no calendars to clear. Add them to the stage first.' }, 400);
    }

    try {
      const result = await offerInterviewSlots(db, c.env as Env, {
        tenantId,
        interviewId,
        panelRefs,
        durationMinutes: Number(body.durationMinutes ?? 45),
        candidateTimezone: typeof body.candidateTimezone === 'string' ? body.candidateTimezone : null,
        ...(typeof body.from === 'string' ? { fromMs: Date.parse(body.from) } : {}),
        ...(typeof body.to === 'string' ? { toMs: Date.parse(body.to) } : {}),
        ...(body.count === undefined ? {} : { count: Number(body.count) }),
        ...(body.linkDays === undefined ? {} : { linkDays: Number(body.linkDays) }),
      });
      if ('error' in result) return c.json({ error: result.error }, 409);
      return c.json(result);
    } catch (error) {
      reportCaughtError(error, { source: 'hiringRoutes', operation: 'offerSlots' });
      return c.json({ error: 'Could not create the booking link.' }, 500);
    }
  });

  // POST /candidates/:ref/consent — record the lawful basis and the retention clock.
  r.post('/candidates/:ref/consent', async (c) => {
    const tenantId = scope(c as never);
    const candidateRef = c.req.param('ref');
    const body = await c.req.json<{
      basis?: unknown; consentAt?: unknown; retentionBasis?: unknown; retentionDate?: unknown;
    }>().catch(() => ({} as Record<string, unknown>));

    if (!isLawfulBasis(body.basis)) {
      return c.json({ error: `Lawful basis must be one of: ${LAWFUL_BASES.join(', ')}.` }, 400);
    }
    if (body.retentionBasis !== undefined && !isRetentionBasis(body.retentionBasis)) {
      return c.json({ error: `Retention basis must be one of: ${RETENTION_BASES.join(', ')}.` }, 400);
    }

    const result = await recordCandidateConsent(db, tenantId, candidateRef, {
      basis: body.basis,
      ...(typeof body.consentAt === 'string' && body.consentAt ? { consentAt: body.consentAt } : {}),
      ...(isRetentionBasis(body.retentionBasis) ? { retentionBasis: body.retentionBasis } : {}),
      ...(typeof body.retentionDate === 'string' && body.retentionDate ? { retentionDate: body.retentionDate } : {}),
    });
    if (!result.ok) return c.json({ error: 'No candidate role for that person.' }, 404);
    return c.json({ ok: true });
  });

  /**
   * POST /candidates/:ref/erase — honour an erasure request.
   *
   * Stamps `erased_at` on the role and DELETES the segregated demographic rows. The role
   * itself is retained-and-marked rather than deleted, which is the standard shape for a
   * suppression record: a deleted row cannot stop a re-import bringing the person back,
   * and bringing back somebody who exercised their right to be forgotten is a second
   * breach rather than a recovery.
   */
  r.post('/candidates/:ref/erase', async (c) => {
    const tenantId = scope(c as never);
    const candidateRef = c.req.param('ref');
    try {
      const result = await eraseCandidateRecord(db, tenantId, candidateRef);
      if (!result.ok) return c.json({ error: 'No candidate role for that person.' }, 404);
      await invalidateHiringFunnel(c.env as Env, tenantId);
      return c.json({ ok: true, erasedAt: result.erasedAt });
    } catch (error) {
      reportCaughtError(error, { source: 'hiringRoutes', operation: 'erase' });
      return c.json({ error: 'Could not complete the erasure.' }, 500);
    }
  });

  /**
   * GET /diversity — statutory reporting, WITHOUT identifiers.
   *
   * The only read of `candidate_demographics` anywhere, and it returns counts grouped by
   * category and response. That is the whole reason the table is registered `restricted`
   * and unreachable through the generic entity reader: the lawful use of this data is
   * aggregate reporting, and a row-level read beside a candidate is the unlawful one.
   *
   * Small groups are suppressed. A count of one in a category re-identifies the person
   * as surely as their name would, which is exactly the disclosure the segregation
   * exists to prevent.
   */
  r.get('/diversity', async (c) => {
    const tenantId = scope(c as never);
    try {
      return c.json(await candidateDiversityReport(db, tenantId));
    } catch (error) {
      reportCaughtError(error, { source: 'hiringRoutes', operation: 'diversity' });
      return c.json({ error: 'Could not read the report.' }, 500);
    }
  });

  return r;
}
