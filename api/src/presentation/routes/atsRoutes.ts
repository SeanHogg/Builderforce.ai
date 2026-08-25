/**
 * The ATS surface — /api/ats/*
 *
 *   GET    /postings?status=                 — the tenant's requisitions with their REAL
 *                                              application counts (FO-B3)
 *   POST   /postings                         — resolve a canvas `jobPosting` card to its
 *                                              `job_postings` row, minting it once
 *   POST   /applications                     — admit a candidate AND record the application
 *   GET    /applications?jobPostingId=&status= — the applications for a posting
 *   GET    /applications/:id                 — one application, with the résumé projection,
 *                                              its decisions and its offers
 *   POST   /applications/:id/reject          — reject, with the reason on the row
 *   GET    /pipelines                        — the pipelines that have candidates in them
 *   GET    /pipelines/:ref/board             — the board of candidates by stage
 *   POST   /pipelines/:ref/move              — move or reorder a candidate
 *   GET    /kits · POST /kits · PATCH /kits/:id · DELETE /kits/:id
 *   POST   /kits/default                     — the house loop, seeded on first ask
 *   POST   /applications/:id/decisions       — record a decision; it moves the pipeline
 *   GET    /offers · POST /offers · PATCH /offers/:id
 *   POST   /offers/:id/send                  — through the signature engine, once
 *   POST   /offers/:id/respond               — accepted / declined
 *
 * ── WHY A SECOND HIRING ROUTE ────────────────────────────────────────────────────
 * `hiringRoutes.ts` is the Recruiter's REPORTING and compliance surface — the funnel,
 * consent, erasure, diversity, booking links. This is the WORKING surface: the rows a
 * recruiter changes during a day. They are separated because their gates differ (reading
 * a funnel is not writing a rejection) and because the compliance endpoints are read by
 * the canvas and the public booking page, which have no business behind a manager gate.
 *
 * ── THIN, LIKE ITS NEIGHBOUR ─────────────────────────────────────────────────────
 * Every handler is an application call and a shape check. There is no SQL here and no
 * stage vocabulary: the vocabulary is `domain/hiring/pipelineStages.ts`, which the UI
 * also reads through `/pipelines/:ref/board`, so a stage name is never typed twice.
 *
 * ── THE GATE ─────────────────────────────────────────────────────────────────────
 * Reads require DEVELOPER (any workspace member), writes require MANAGER — the same
 * split `quality.*` and `alerts.*` use, mirrored by the frontend's `hiring.view` /
 * `hiring.manage` capabilities so `<RoleGate>` disables exactly what the server refuses.
 * Rejecting somebody, recording a decision and sending an offer are all accountable acts
 * with an external effect on a person, which is the line the manager gate marks.
 */
import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv, Env } from '../../env';
import { TenantRole } from '../../domain/shared/types';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import { AtsError } from '../../application/hiring/atsError';
import { admitCandidate, candidateRefForUser } from '../../application/hiring/candidateIntake';
import {
  listApplications,
  readApplication,
  recordApplication,
} from '../../application/hiring/applications';
import { listCanvasPostings, syncCanvasPosting } from '../../application/hiring/postings';
import { listPipelines, pipelineBoard, moveCandidate } from '../../application/hiring/pipeline';
import {
  createInterviewKit,
  deleteInterviewKit,
  ensureDefaultKit,
  listInterviewKits,
  updateInterviewKit,
  type InterviewKitStageInput,
} from '../../application/hiring/interviewKits';
import { listDecisions, recordDecision } from '../../application/hiring/decisions';
import {
  draftOffer,
  listOffers,
  readOffer,
  respondToOffer,
  sendOffer,
  updateOffer,
} from '../../application/hiring/offers';
import { readCandidateResume } from '../../application/hiring/candidateResumeProjection';
import {
  DEFAULT_PIPELINE_STAGES,
  HIRING_DECISIONS,
  INTERVIEW_KIT_STAGE_KINDS,
  REJECTED_STAGE,
} from '../../domain/hiring/pipelineStages';
import { OFFER_STATUSES } from '../../domain/hiring/offerLetter';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

/** The body of a request, or an empty object — a malformed body is a shape failure the
 *  handler's own validation reports, not a 500 from `c.req.json()`. */
async function body<T extends Record<string, unknown>>(c: { req: { json: <B>() => Promise<B> } }): Promise<Partial<T>> {
  return c.req.json<Partial<T>>().catch(() => ({} as Partial<T>));
}

const asString = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

export function createAtsRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  r.use('*', authMiddleware);

  const scope = (c: { get: (key: 'tenantId') => number | undefined }) => c.get('tenantId') ?? 0;

  /**
   * Map an application-layer refusal onto its status code, once.
   *
   * `AtsError` carries the status the service decided on, so a route never re-decides
   * whether "already sent" is a 400 or a 409. Anything that is NOT an `AtsError` is an
   * unexpected failure: it is reported and answered with a 500 rather than leaking its
   * message, because a database error's text is not something a caller should read.
   */
  const failed = (c: { json: (body: unknown, status?: 400 | 404 | 409 | 500) => Response }, operation: string, error: unknown): Response => {
    if (error instanceof AtsError) {
      const status = error.status === 404 ? 404 : error.status === 409 ? 409 : error.status === 400 ? 400 : 500;
      return c.json({ error: error.message }, status);
    }
    reportCaughtError(error, { source: 'atsRoutes', operation });
    return c.json({ error: 'That could not be completed.' }, 500);
  };

  // ── The vocabulary, so the UI never hardcodes a stage name ──────────────────────
  r.get('/vocabulary', async (c) => c.json({
    stages: [...DEFAULT_PIPELINE_STAGES, REJECTED_STAGE],
    decisions: HIRING_DECISIONS,
    kitStageKinds: INTERVIEW_KIT_STAGE_KINDS,
    offerStatuses: OFFER_STATUSES,
  }));

  // ── Postings (FO-B3) ───────────────────────────────────────────────────────────
  //
  // The requisition, with the applications actually counted against it. This is the
  // read the canvas `jobPosting` card refreshes from, and it is here rather than on
  // `/api/jobs` for the reason the two surfaces are split at all: `/api/jobs` is the
  // MARKETPLACE door — public browse, proposals, bids — while a requisition's
  // applicant volume is the Recruiter's working number. The counts come from
  // `job_applications`, which is this domain's table.

  /**
   * Every posting this workspace holds, with its real application counts.
   *
   * DEVELOPER, like every other read here: knowing how many people applied is not an
   * accountable act. The projection carries no candidate identities at all — it is
   * counts and a source breakdown — so it is also the read that is safe to put on a
   * board somebody may later share.
   */
  r.get('/postings', requireRole(TenantRole.DEVELOPER), async (c) => {
    try {
      return c.json({
        postings: await listCanvasPostings(db, scope(c as never), {
          status: c.req.query('status') || null,
        }),
      });
    } catch (error) {
      return failed(c, 'listCanvasPostings', error);
    }
  });

  /**
   * Resolve a canvas card to its posting — minting the row the first time.
   *
   * MANAGER, and only because of the create half: publishing a requisition commits the
   * workspace to a hire, and it is the same gate `POST /api/jobs` sits behind. A body
   * carrying `postingId` performs no write at all, but it shares the endpoint because
   * the CALLER cannot know which of the two it is doing — a canvas card either has an
   * id or it does not, and splitting that into two endpoints would make the tool
   * decide, which is the decision that must not be got wrong.
   *
   * The response is the same projection `GET /postings` returns, so the board is
   * redrawn from the response that performed the write rather than from a second read
   * that could disagree with it.
   */
  r.post('/postings', requireRole(TenantRole.MANAGER), async (c) => {
    const input = await body<{ postingId: string; draft: Record<string, unknown> }>(c);
    try {
      const result = await syncCanvasPosting(db, c.env as Env, {
        tenantId: scope(c as never),
        actorUserId: c.get('userId') ?? '',
        postingId: asString(input.postingId),
        draft: (input.draft ?? {}) as Parameters<typeof syncCanvasPosting>[2]['draft'],
      });
      return c.json(result, result.created ? 201 : 200);
    } catch (error) {
      return failed(c, 'syncCanvasPosting', error);
    }
  });

  // ── Applications ───────────────────────────────────────────────────────────────

  r.get('/applications', requireRole(TenantRole.DEVELOPER), async (c) => {
    try {
      return c.json({
        applications: await listApplications(db, scope(c as never), {
          jobPostingId: c.req.query('jobPostingId') || null,
          status: c.req.query('status') || null,
          candidateRef: c.req.query('candidateRef') || null,
        }),
      });
    } catch (error) {
      return failed(c, 'listApplications', error);
    }
  });

  /**
   * The candidate drawer's ONE read.
   *
   * Four services, composed here rather than in a component: the application, the résumé
   * the employer holds, the decision history and the offers. Composed at the route
   * because each is independently useful (the board reads the first, the offer panel the
   * last) and a service that fetched all four would make every one of those callers pay
   * for the other three.
   */
  r.get('/applications/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = scope(c as never);
    const applicationId = Number(c.req.param('id'));
    if (!Number.isInteger(applicationId)) return c.json({ error: 'Unknown application.' }, 400);
    try {
      const application = await readApplication(db, tenantId, applicationId);
      if (!application) return c.json({ error: 'No such application in this workspace.' }, 404);
      const [resume, decisions, offers] = await Promise.all([
        readCandidateResume(db, { tenantId, candidateRef: application.candidateRef }),
        listDecisions(db, tenantId, { applicationId }),
        listOffers(db, tenantId, { applicationId }),
      ]);
      return c.json({ application, resume, decisions, offers });
    } catch (error) {
      return failed(c, 'readApplication', error);
    }
  });

  /**
   * Record an application.
   *
   * Two ways in, one act. Given a `userId` this goes through `admitCandidate`, which
   * registers the party role, snapshots the résumé AND records the application — the
   * platform applicant's path. Given a bare `candidateRef` it records the application
   * for somebody a recruiter sourced, who has no platform account to project a résumé
   * from. Both end in the same row and the same pipeline entry.
   */
  r.post('/applications', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = scope(c as never);
    const input = await body<{ userId: string; candidateRef: string; jobPostingId: string; source: string; coverLetter: string }>(c);
    const jobPostingId = asString(input.jobPostingId);
    if (!jobPostingId) return c.json({ error: 'Name the posting this application is for.' }, 400);

    const userId = asString(input.userId);
    const candidateRef = asString(input.candidateRef) ?? (userId ? candidateRefForUser(userId) : null);
    if (!candidateRef) return c.json({ error: 'Name the candidate, by user id or by candidate ref.' }, 400);

    try {
      if (userId) {
        const intake = await admitCandidate(db, {
          userId,
          tenantId,
          jobPostingId,
          env: c.env as Env,
          ...(asString(input.source) ? { source: asString(input.source) as string } : {}),
          coverLetter: asString(input.coverLetter),
        });
        return c.json(intake, 201);
      }
      const recorded = await recordApplication(db, c.env as Env, {
        tenantId,
        jobPostingId,
        candidateRef,
        source: asString(input.source) ?? 'sourced',
        coverLetter: asString(input.coverLetter),
      });
      return c.json({ candidateRef, resumeProjected: false, applicationId: recorded.applicationId }, 201);
    } catch (error) {
      return failed(c, 'recordApplication', error);
    }
  });

  /**
   * Reject an application.
   *
   * Goes through `recordDecision`, not straight to the row: a rejection is a decision
   * somebody is accountable for, and routing it through the decision path is what keeps
   * `hiring_decisions` a complete record rather than one that is missing exactly the
   * outcomes people later ask about.
   */
  r.post('/applications/:id/reject', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = scope(c as never);
    const applicationId = Number(c.req.param('id'));
    if (!Number.isInteger(applicationId)) return c.json({ error: 'Unknown application.' }, 400);
    const input = await body<{ reason: string; evidence: Record<string, unknown> }>(c);
    const reason = asString(input.reason);
    if (!reason) return c.json({ error: 'A rejection needs a reason — it is the answer to "why" six months from now.' }, 400);
    try {
      const actor = await resolveActorFromContext(c.env as Env, db, c);
      const result = await recordDecision(db, c.env as Env, {
        tenantId,
        applicationId,
        decision: 'reject',
        rationale: reason,
        evidence: input.evidence ?? null,
        actor,
      });
      return c.json(result);
    } catch (error) {
      return failed(c, 'rejectApplication', error);
    }
  });

  // ── The board ──────────────────────────────────────────────────────────────────

  /** Every pipeline with candidates in it, so the board's picker is a list of real
   *  requisitions rather than uuids somebody has to paste. */
  r.get('/pipelines', requireRole(TenantRole.DEVELOPER), async (c) => {
    try {
      return c.json({ pipelines: await listPipelines(c.env as Env, db, scope(c as never)) });
    } catch (error) {
      return failed(c, 'listPipelines', error);
    }
  });

  r.get('/pipelines/:ref/board', requireRole(TenantRole.DEVELOPER), async (c) => {
    try {
      return c.json(await pipelineBoard(c.env as Env, db, scope(c as never), c.req.param('ref')));
    } catch (error) {
      return failed(c, 'pipelineBoard', error);
    }
  });

  /**
   * Move a candidate, or reorder them within their column.
   *
   * A bare move is deliberately allowed without a decision: dragging a card into
   * `screen` because the screen is booked is not a decision, and forcing a rationale
   * onto it teaches people to type nothing meaningful. The moves that ARE decisions —
   * rejection, offer, hire — go through `/decisions`, which records why.
   */
  r.post('/pipelines/:ref/move', requireRole(TenantRole.MANAGER), async (c) => {
    const input = await body<{ candidateRef: string; toStage: string; position: number; ownerRef: string }>(c);
    const candidateRef = asString(input.candidateRef);
    const toStage = asString(input.toStage);
    if (!candidateRef || !toStage) return c.json({ error: 'Name the candidate and the stage to move them to.' }, 400);
    try {
      return c.json(await moveCandidate(db, c.env as Env, {
        tenantId: scope(c as never),
        pipelineRef: c.req.param('ref'),
        candidateRef,
        toStage,
        position: typeof input.position === 'number' ? input.position : null,
        ...(asString(input.ownerRef) ? { ownerRef: asString(input.ownerRef) } : {}),
      }));
    } catch (error) {
      return failed(c, 'moveCandidate', error);
    }
  });

  // ── Interview kits ─────────────────────────────────────────────────────────────

  r.get('/kits', requireRole(TenantRole.DEVELOPER), async (c) => {
    try {
      return c.json({ kits: await listInterviewKits(c.env as Env, db, scope(c as never)) });
    } catch (error) {
      return failed(c, 'listInterviewKits', error);
    }
  });

  /** Seed (or return) the tenant's default loop. A template surface that opens empty is
   *  a template surface nobody uses. */
  r.post('/kits/default', requireRole(TenantRole.MANAGER), async (c) => {
    try {
      const kit = await ensureDefaultKit(db, c.env as Env, scope(c as never), c.get('userId') ?? null);
      return c.json({ kit });
    } catch (error) {
      return failed(c, 'ensureDefaultKit', error);
    }
  });

  r.post('/kits', requireRole(TenantRole.MANAGER), async (c) => {
    const input = await body<{ name: string; roleFamily: string; description: string; isDefault: boolean; stages: InterviewKitStageInput[] }>(c);
    const name = asString(input.name);
    if (!name) return c.json({ error: 'A kit needs a name — it is how a recruiter picks it.' }, 400);
    try {
      const kit = await createInterviewKit(db, c.env as Env, scope(c as never), {
        name,
        roleFamily: asString(input.roleFamily),
        description: asString(input.description),
        isDefault: input.isDefault === true,
        stages: Array.isArray(input.stages) ? input.stages : [],
        createdBy: c.get('userId') ?? null,
      });
      return c.json({ kit }, 201);
    } catch (error) {
      return failed(c, 'createInterviewKit', error);
    }
  });

  r.patch('/kits/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const kitId = Number(c.req.param('id'));
    if (!Number.isInteger(kitId)) return c.json({ error: 'Unknown kit.' }, 400);
    const input = await body<{ name: string; roleFamily: string; description: string; isDefault: boolean; stages: InterviewKitStageInput[] }>(c);
    try {
      const kit = await updateInterviewKit(db, c.env as Env, scope(c as never), kitId, {
        ...(input.name !== undefined ? { name: String(input.name) } : {}),
        ...(input.roleFamily !== undefined ? { roleFamily: asString(input.roleFamily) } : {}),
        ...(input.description !== undefined ? { description: asString(input.description) } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault === true } : {}),
        ...(Array.isArray(input.stages) ? { stages: input.stages } : {}),
      });
      return c.json({ kit });
    } catch (error) {
      return failed(c, 'updateInterviewKit', error);
    }
  });

  r.delete('/kits/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const kitId = Number(c.req.param('id'));
    if (!Number.isInteger(kitId)) return c.json({ error: 'Unknown kit.' }, 400);
    try {
      await deleteInterviewKit(db, c.env as Env, scope(c as never), kitId);
      return c.json({ ok: true });
    } catch (error) {
      return failed(c, 'deleteInterviewKit', error);
    }
  });

  // ── Decisions ──────────────────────────────────────────────────────────────────

  r.get('/applications/:id/decisions', requireRole(TenantRole.DEVELOPER), async (c) => {
    const applicationId = Number(c.req.param('id'));
    if (!Number.isInteger(applicationId)) return c.json({ error: 'Unknown application.' }, 400);
    try {
      return c.json({ decisions: await listDecisions(db, scope(c as never), { applicationId }) });
    } catch (error) {
      return failed(c, 'listDecisions', error);
    }
  });

  r.post('/applications/:id/decisions', requireRole(TenantRole.MANAGER), async (c) => {
    const applicationId = Number(c.req.param('id'));
    if (!Number.isInteger(applicationId)) return c.json({ error: 'Unknown application.' }, 400);
    const input = await body<{ decision: string; rationale: string; evidence: Record<string, unknown> }>(c);
    try {
      const actor = await resolveActorFromContext(c.env as Env, db, c);
      return c.json(await recordDecision(db, c.env as Env, {
        tenantId: scope(c as never),
        applicationId,
        decision: String(input.decision ?? ''),
        rationale: asString(input.rationale),
        evidence: input.evidence ?? null,
        actor,
      }), 201);
    } catch (error) {
      return failed(c, 'recordDecision', error);
    }
  });

  // ── Offers ─────────────────────────────────────────────────────────────────────

  r.get('/offers', requireRole(TenantRole.DEVELOPER), async (c) => {
    const applicationId = Number(c.req.query('applicationId'));
    try {
      return c.json({
        offers: await listOffers(db, scope(c as never), {
          applicationId: Number.isInteger(applicationId) ? applicationId : null,
          candidateRef: c.req.query('candidateRef') || null,
          status: c.req.query('status') || null,
        }),
      });
    } catch (error) {
      return failed(c, 'listOffers', error);
    }
  });

  r.post('/offers', requireRole(TenantRole.MANAGER), async (c) => {
    const input = await body<{
      applicationId: number; candidateRef: string; title: string; baseSalary: number;
      currency: string; equity: string; startDate: string; expiresAt: string; terms: Record<string, unknown>;
    }>(c);
    const title = asString(input.title);
    if (!title) return c.json({ error: 'An offer needs a role title.' }, 400);
    try {
      const offer = await draftOffer(db, c.env as Env, {
        tenantId: scope(c as never),
        applicationId: typeof input.applicationId === 'number' ? input.applicationId : null,
        candidateRef: asString(input.candidateRef),
        title,
        baseSalary: input.baseSalary ?? null,
        currency: asString(input.currency),
        equity: asString(input.equity),
        startDate: asString(input.startDate),
        expiresAt: asString(input.expiresAt),
        terms: input.terms ?? null,
      });
      return c.json({ offer }, 201);
    } catch (error) {
      return failed(c, 'draftOffer', error);
    }
  });

  r.patch('/offers/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const offerId = Number(c.req.param('id'));
    if (!Number.isInteger(offerId)) return c.json({ error: 'Unknown offer.' }, 400);
    const input = await body<{
      title: string; baseSalary: number; currency: string; equity: string;
      startDate: string; expiresAt: string; terms: Record<string, unknown>; approve: boolean;
    }>(c);
    try {
      const offer = await updateOffer(db, scope(c as never), offerId, {
        ...(input.title !== undefined ? { title: String(input.title) } : {}),
        ...(input.baseSalary !== undefined ? { baseSalary: input.baseSalary } : {}),
        ...(input.currency !== undefined ? { currency: asString(input.currency) } : {}),
        ...(input.equity !== undefined ? { equity: asString(input.equity) } : {}),
        ...(input.startDate !== undefined ? { startDate: asString(input.startDate) } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: asString(input.expiresAt) } : {}),
        ...(input.terms !== undefined ? { terms: input.terms ?? null } : {}),
        ...(input.approve !== undefined ? { approve: input.approve === true } : {}),
      });
      return c.json({ offer });
    } catch (error) {
      return failed(c, 'updateOffer', error);
    }
  });

  r.get('/offers/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const offerId = Number(c.req.param('id'));
    if (!Number.isInteger(offerId)) return c.json({ error: 'Unknown offer.' }, 400);
    try {
      const offer = await readOffer(db, scope(c as never), offerId);
      if (!offer) return c.json({ error: 'No such offer in this workspace.' }, 404);
      return c.json({ offer });
    } catch (error) {
      return failed(c, 'readOffer', error);
    }
  });

  /**
   * Send for signature.
   *
   * The invitation tokens come back ONCE, in this response, and are not recoverable —
   * that is the signature engine's contract, not a decision this route makes. The caller
   * is what delivers them.
   */
  r.post('/offers/:id/send', requireRole(TenantRole.MANAGER), async (c) => {
    const offerId = Number(c.req.param('id'));
    if (!Number.isInteger(offerId)) return c.json({ error: 'Unknown offer.' }, 400);
    const input = await body<{ parties: Array<{ name: string; email: string }>; remindAfterDays: number }>(c);
    const parties = (Array.isArray(input.parties) ? input.parties : [])
      .map((party) => ({ name: String(party?.name ?? '').trim(), email: String(party?.email ?? '').trim() }))
      .filter((party) => party.name && party.email.includes('@'));
    if (!parties.length) return c.json({ error: 'Name the candidate the offer goes to, with an email to reach them at.' }, 400);
    try {
      const actor = await resolveActorFromContext(c.env as Env, db, c);
      const sent = await sendOffer(db, c.env as Env, {
        tenantId: scope(c as never),
        offerId,
        parties,
        ...(typeof input.remindAfterDays === 'number' ? { remindAfterDays: input.remindAfterDays } : {}),
        createdBy: c.get('userId') ?? null,
        actor,
      });
      return c.json(sent);
    } catch (error) {
      return failed(c, 'sendOffer', error);
    }
  });

  r.post('/offers/:id/respond', requireRole(TenantRole.MANAGER), async (c) => {
    const offerId = Number(c.req.param('id'));
    if (!Number.isInteger(offerId)) return c.json({ error: 'Unknown offer.' }, 400);
    const input = await body<{ response: string; note: string }>(c);
    try {
      const actor = await resolveActorFromContext(c.env as Env, db, c);
      return c.json(await respondToOffer(db, c.env as Env, {
        tenantId: scope(c as never),
        offerId,
        response: String(input.response ?? ''),
        note: asString(input.note),
        actor,
      }));
    } catch (error) {
      return failed(c, 'respondToOffer', error);
    }
  });

  return r;
}
