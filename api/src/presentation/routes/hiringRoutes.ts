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
 *
 * Nothing here catches: an application failure is an invariant failure the global
 * handler reports and answers generically, so no route carries its own 500.
 */
import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv, Env } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import { hiringFunnel, invalidateHiringFunnel } from '../../application/hiring/hiringFunnel';
import { interviewPanelRefs, offerInterviewSlots } from '../../application/hiring/interviewScheduling';
import {
  candidateDiversityReport, eraseCandidateRecord,
  recordCandidateConsent, LAWFUL_BASES, RETENTION_BASES,
} from '../../application/hiring/candidateRecords';
import { parseBody, z, zOptionalString } from './requestBody';

// ── Request bodies ───────────────────────────────────────────────────────────

/** Numeric fields arrive as numbers from the app, as strings from a form — both are admitted. */
const OfferSlotsBody = z.object({
  durationMinutes: z.coerce.number().optional(),
  candidateTimezone: z.string().nullable().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  count: z.coerce.number().optional(),
  linkDays: z.coerce.number().optional(),
});

const ConsentBody = z.object({
  basis: z.enum(LAWFUL_BASES, { error: `Lawful basis must be one of: ${LAWFUL_BASES.join(', ')}.` }),
  consentAt: zOptionalString,
  retentionBasis: z.enum(RETENTION_BASES, { error: `Retention basis must be one of: ${RETENTION_BASES.join(', ')}.` }).optional(),
  retentionDate: zOptionalString,
});

export function createHiringRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  r.use('*', authMiddleware);

  const scope = (c: { get: (key: 'tenantId') => number | undefined }) => c.get('tenantId') ?? 0;

  // GET /funnel?pipelineRef=&days=
  r.get('/funnel', async (c) => {
    const tenantId = scope(c as never);
    const pipelineRef = c.req.query('pipelineRef') || null;
    const days = Number(c.req.query('days') ?? 90);
    return c.json(await hiringFunnel(c.env as Env, db, tenantId, { pipelineRef, days }));
  });

  // POST /interviews/:id/offer-slots — mint the candidate's self-schedule link.
  r.post('/interviews/:id/offer-slots', async (c) => {
    const tenantId = scope(c as never);
    const interviewId = Number(c.req.param('id'));
    if (!Number.isInteger(interviewId)) return c.json({ error: 'Unknown interview.' }, 400);

    const body = await parseBody(c, OfferSlotsBody);

    // The panel comes from the interview's kit stage, never from the request — the same
    // rule the public booking route follows, for the same reason: a client-supplied
    // panel is a client-supplied availability check.
    const panelRefs = await interviewPanelRefs(db, tenantId, interviewId);
    if (!panelRefs.length) {
      return c.json({ error: 'This interview stage names no interviewers, so there are no calendars to clear. Add them to the stage first.' }, 400);
    }

    const result = await offerInterviewSlots(db, c.env as Env, {
      tenantId,
      interviewId,
      panelRefs,
      durationMinutes: body.durationMinutes ?? 45,
      candidateTimezone: body.candidateTimezone ?? null,
      ...(body.from !== undefined ? { fromMs: Date.parse(body.from) } : {}),
      ...(body.to !== undefined ? { toMs: Date.parse(body.to) } : {}),
      ...(body.count === undefined ? {} : { count: body.count }),
      ...(body.linkDays === undefined ? {} : { linkDays: body.linkDays }),
    });
    if ('error' in result) return c.json({ error: result.error }, 409);
    return c.json(result);
  });

  // POST /candidates/:ref/consent — record the lawful basis and the retention clock.
  r.post('/candidates/:ref/consent', async (c) => {
    const tenantId = scope(c as never);
    const candidateRef = c.req.param('ref');
    const body = await parseBody(c, ConsentBody);

    const result = await recordCandidateConsent(db, tenantId, candidateRef, {
      basis: body.basis,
      ...(body.consentAt !== undefined ? { consentAt: body.consentAt } : {}),
      ...(body.retentionBasis !== undefined ? { retentionBasis: body.retentionBasis } : {}),
      ...(body.retentionDate !== undefined ? { retentionDate: body.retentionDate } : {}),
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
    const result = await eraseCandidateRecord(db, tenantId, candidateRef);
    if (!result.ok) return c.json({ error: 'No candidate role for that person.' }, 404);
    await invalidateHiringFunnel(c.env as Env, tenantId);
    return c.json({ ok: true, erasedAt: result.erasedAt });
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
    return c.json(await candidateDiversityReport(db, tenantId));
  });

  return r;
}
