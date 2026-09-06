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
 * The shape check is a zod schema per body (below), read through `parseBody` so a
 * wrong field answers `400 { error, issues }` naming the field. `AtsError` carries the
 * status the service decided on — 400 / 404 / 409, 500 for an invariant failure — and
 * the global handler renders it through `statusOf`, so no handler here catches anything.
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
import { OFFER_RESPONSES, OFFER_STATUSES } from '../../domain/hiring/offerLetter';
import { parseBody, z, zNonEmptyString, zOptionalString, zPositiveInt } from './requestBody';

// ── Body schemas ─────────────────────────────────────────────────────────────────

/** A free-form JSON object: a posting draft, decision evidence, offer terms. */
const zJsonObject = z.record(z.string(), z.unknown());

/**
 * An optional field a PATCH may CLEAR: absent leaves the column alone, `""` or `null`
 * clears it, text sets it. `zOptionalString` cannot say "clear", so patches use this.
 */
const zClearableString = z.string().nullable().optional();

/** `""`/`null` → `null`, text → trimmed text. The column value for a {@link zClearableString}. */
const cleared = (value: string | null | undefined): string | null => (value?.trim() ? value.trim() : null);

const PostingBody = z.object({
  postingId: zOptionalString,
  draft: zJsonObject.optional(),
});

const ApplicationBody = z.object({
  jobPostingId: zNonEmptyString,
  userId: zOptionalString,
  candidateRef: zOptionalString,
  source: zOptionalString,
  coverLetter: zOptionalString,
});

const RejectBody = z.object({
  reason: zNonEmptyString,
  evidence: zJsonObject.nullable().optional(),
});

const MoveBody = z.object({
  candidateRef: zNonEmptyString,
  toStage: zNonEmptyString,
  position: z.number().int().nullable().optional(),
  ownerRef: zOptionalString,
});

const ScorecardAttribute = z.object({
  key: z.string(),
  label: z.string(),
  weight: z.number().optional(),
  scaleMin: z.number().optional(),
  scaleMax: z.number().optional(),
});

const KitStage = z.object({
  name: z.string(),
  kind: z.string().optional(),
  durationMin: z.number().nullable().optional(),
  interviewerRefs: z.array(z.string()).optional(),
  guidance: z.string().nullable().optional(),
  /** Reuse an existing scorecard (a canvas object) instead of minting one. */
  scorecardId: z.string().nullable().optional(),
  scorecard: z.array(ScorecardAttribute).optional(),
});

const CreateKitBody = z.object({
  name: zNonEmptyString,
  roleFamily: zOptionalString,
  description: zOptionalString,
  isDefault: z.boolean().optional(),
  stages: z.array(KitStage).optional(),
});

const UpdateKitBody = z.object({
  name: z.string().optional(),
  roleFamily: zClearableString,
  description: zClearableString,
  isDefault: z.boolean().optional(),
  stages: z.array(KitStage).optional(),
});

const DecisionBody = z.object({
  decision: z.enum(HIRING_DECISIONS),
  rationale: zOptionalString,
  evidence: zJsonObject.nullable().optional(),
});

/** A salary may arrive as a number or as the string a form field holds; the service parses it. */
const zSalary = z.union([z.number(), z.string()]).nullable().optional();

const DraftOfferBody = z.object({
  applicationId: zPositiveInt.nullable().optional(),
  candidateRef: zOptionalString,
  title: zNonEmptyString,
  baseSalary: zSalary,
  currency: zOptionalString,
  equity: zOptionalString,
  startDate: zOptionalString,
  expiresAt: zOptionalString,
  terms: zJsonObject.nullable().optional(),
});

const UpdateOfferBody = z.object({
  title: z.string().optional(),
  baseSalary: zSalary,
  currency: zClearableString,
  equity: zClearableString,
  startDate: zClearableString,
  expiresAt: zClearableString,
  terms: zJsonObject.nullable().optional(),
  approve: z.boolean().optional(),
});

const SendOfferBody = z.object({
  parties: z.array(z.object({
    name: zNonEmptyString,
    email: z.string().trim().includes('@'),
  })).min(1),
  remindAfterDays: zPositiveInt.optional(),
});

const RespondBody = z.object({
  response: z.enum(OFFER_RESPONSES),
  note: zOptionalString,
});

export function createAtsRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  r.use('*', authMiddleware);

  const scope = (c: { get: (key: 'tenantId') => number | undefined }) => c.get('tenantId') ?? 0;

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
  r.get('/postings', requireRole(TenantRole.DEVELOPER), async (c) => c.json({
    postings: await listCanvasPostings(db, scope(c as never), {
      status: c.req.query('status') || null,
    }),
  }));

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
    const input = await parseBody(c, PostingBody);
    const result = await syncCanvasPosting(db, c.env as Env, {
      tenantId: scope(c as never),
      actorUserId: c.get('userId') ?? '',
      postingId: input.postingId ?? null,
      draft: (input.draft ?? {}) as Parameters<typeof syncCanvasPosting>[2]['draft'],
    });
    return c.json(result, result.created ? 201 : 200);
  });

  // ── Applications ───────────────────────────────────────────────────────────────

  r.get('/applications', requireRole(TenantRole.DEVELOPER), async (c) => c.json({
    applications: await listApplications(db, scope(c as never), {
      jobPostingId: c.req.query('jobPostingId') || null,
      status: c.req.query('status') || null,
      candidateRef: c.req.query('candidateRef') || null,
    }),
  }));

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
    const application = await readApplication(db, tenantId, applicationId);
    if (!application) return c.json({ error: 'No such application in this workspace.' }, 404);
    const [resume, decisions, offers] = await Promise.all([
      readCandidateResume(db, { tenantId, candidateRef: application.candidateRef }),
      listDecisions(db, tenantId, { applicationId }),
      listOffers(db, tenantId, { applicationId }),
    ]);
    return c.json({ application, resume, decisions, offers });
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
    const input = await parseBody(c, ApplicationBody);

    const userId = input.userId ?? null;
    const candidateRef = input.candidateRef ?? (userId ? candidateRefForUser(userId) : null);
    if (!candidateRef) return c.json({ error: 'Name the candidate, by user id or by candidate ref.' }, 400);

    if (userId) {
      const intake = await admitCandidate(db, {
        userId,
        tenantId,
        jobPostingId: input.jobPostingId,
        env: c.env as Env,
        ...(input.source ? { source: input.source } : {}),
        coverLetter: input.coverLetter ?? null,
      });
      return c.json(intake, 201);
    }
    const recorded = await recordApplication(db, c.env as Env, {
      tenantId,
      jobPostingId: input.jobPostingId,
      candidateRef,
      source: input.source ?? 'sourced',
      coverLetter: input.coverLetter ?? null,
    });
    return c.json({ candidateRef, resumeProjected: false, applicationId: recorded.applicationId }, 201);
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
    const input = await parseBody(c, RejectBody);
    const actor = await resolveActorFromContext(c.env as Env, db, c);
    const result = await recordDecision(db, c.env as Env, {
      tenantId,
      applicationId,
      decision: 'reject',
      rationale: input.reason,
      evidence: input.evidence ?? null,
      actor,
    });
    return c.json(result);
  });

  // ── The board ──────────────────────────────────────────────────────────────────

  /** Every pipeline with candidates in it, so the board's picker is a list of real
   *  requisitions rather than uuids somebody has to paste. */
  r.get('/pipelines', requireRole(TenantRole.DEVELOPER), async (c) =>
    c.json({ pipelines: await listPipelines(c.env as Env, db, scope(c as never)) }));

  r.get('/pipelines/:ref/board', requireRole(TenantRole.DEVELOPER), async (c) =>
    c.json(await pipelineBoard(c.env as Env, db, scope(c as never), c.req.param('ref'))));

  /**
   * Move a candidate, or reorder them within their column.
   *
   * A bare move is deliberately allowed without a decision: dragging a card into
   * `screen` because the screen is booked is not a decision, and forcing a rationale
   * onto it teaches people to type nothing meaningful. The moves that ARE decisions —
   * rejection, offer, hire — go through `/decisions`, which records why.
   */
  r.post('/pipelines/:ref/move', requireRole(TenantRole.MANAGER), async (c) => {
    const input = await parseBody(c, MoveBody);
    return c.json(await moveCandidate(db, c.env as Env, {
      tenantId: scope(c as never),
      pipelineRef: c.req.param('ref'),
      candidateRef: input.candidateRef,
      toStage: input.toStage,
      position: input.position ?? null,
      ...(input.ownerRef ? { ownerRef: input.ownerRef } : {}),
    }));
  });

  // ── Interview kits ─────────────────────────────────────────────────────────────

  r.get('/kits', requireRole(TenantRole.DEVELOPER), async (c) =>
    c.json({ kits: await listInterviewKits(c.env as Env, db, scope(c as never)) }));

  /** Seed (or return) the tenant's default loop. A template surface that opens empty is
   *  a template surface nobody uses. */
  r.post('/kits/default', requireRole(TenantRole.MANAGER), async (c) => {
    const kit = await ensureDefaultKit(db, c.env as Env, scope(c as never), c.get('userId') ?? null);
    return c.json({ kit });
  });

  r.post('/kits', requireRole(TenantRole.MANAGER), async (c) => {
    const input = await parseBody(c, CreateKitBody);
    const kit = await createInterviewKit(db, c.env as Env, scope(c as never), {
      name: input.name,
      roleFamily: input.roleFamily ?? null,
      description: input.description ?? null,
      isDefault: input.isDefault === true,
      stages: input.stages ?? [],
      createdBy: c.get('userId') ?? null,
    });
    return c.json({ kit }, 201);
  });

  r.patch('/kits/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const kitId = Number(c.req.param('id'));
    if (!Number.isInteger(kitId)) return c.json({ error: 'Unknown kit.' }, 400);
    const input = await parseBody(c, UpdateKitBody);
    const kit = await updateInterviewKit(db, c.env as Env, scope(c as never), kitId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.roleFamily !== undefined ? { roleFamily: cleared(input.roleFamily) } : {}),
      ...(input.description !== undefined ? { description: cleared(input.description) } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.stages ? { stages: input.stages } : {}),
    });
    return c.json({ kit });
  });

  r.delete('/kits/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const kitId = Number(c.req.param('id'));
    if (!Number.isInteger(kitId)) return c.json({ error: 'Unknown kit.' }, 400);
    await deleteInterviewKit(db, c.env as Env, scope(c as never), kitId);
    return c.json({ ok: true });
  });

  // ── Decisions ──────────────────────────────────────────────────────────────────

  r.get('/applications/:id/decisions', requireRole(TenantRole.DEVELOPER), async (c) => {
    const applicationId = Number(c.req.param('id'));
    if (!Number.isInteger(applicationId)) return c.json({ error: 'Unknown application.' }, 400);
    return c.json({ decisions: await listDecisions(db, scope(c as never), { applicationId }) });
  });

  r.post('/applications/:id/decisions', requireRole(TenantRole.MANAGER), async (c) => {
    const applicationId = Number(c.req.param('id'));
    if (!Number.isInteger(applicationId)) return c.json({ error: 'Unknown application.' }, 400);
    const input = await parseBody(c, DecisionBody);
    const actor = await resolveActorFromContext(c.env as Env, db, c);
    return c.json(await recordDecision(db, c.env as Env, {
      tenantId: scope(c as never),
      applicationId,
      decision: input.decision,
      rationale: input.rationale ?? null,
      evidence: input.evidence ?? null,
      actor,
    }), 201);
  });

  // ── Offers ─────────────────────────────────────────────────────────────────────

  r.get('/offers', requireRole(TenantRole.DEVELOPER), async (c) => {
    const applicationId = Number(c.req.query('applicationId'));
    return c.json({
      offers: await listOffers(db, scope(c as never), {
        applicationId: Number.isInteger(applicationId) ? applicationId : null,
        candidateRef: c.req.query('candidateRef') || null,
        status: c.req.query('status') || null,
      }),
    });
  });

  r.post('/offers', requireRole(TenantRole.MANAGER), async (c) => {
    const input = await parseBody(c, DraftOfferBody);
    const offer = await draftOffer(db, c.env as Env, {
      tenantId: scope(c as never),
      applicationId: input.applicationId ?? null,
      candidateRef: input.candidateRef ?? null,
      title: input.title,
      baseSalary: input.baseSalary ?? null,
      currency: input.currency ?? null,
      equity: input.equity ?? null,
      startDate: input.startDate ?? null,
      expiresAt: input.expiresAt ?? null,
      terms: input.terms ?? null,
    });
    return c.json({ offer }, 201);
  });

  r.patch('/offers/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const offerId = Number(c.req.param('id'));
    if (!Number.isInteger(offerId)) return c.json({ error: 'Unknown offer.' }, 400);
    const input = await parseBody(c, UpdateOfferBody);
    const offer = await updateOffer(db, scope(c as never), offerId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.baseSalary !== undefined ? { baseSalary: input.baseSalary } : {}),
      ...(input.currency !== undefined ? { currency: cleared(input.currency) } : {}),
      ...(input.equity !== undefined ? { equity: cleared(input.equity) } : {}),
      ...(input.startDate !== undefined ? { startDate: cleared(input.startDate) } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: cleared(input.expiresAt) } : {}),
      ...(input.terms !== undefined ? { terms: input.terms ?? null } : {}),
      ...(input.approve !== undefined ? { approve: input.approve } : {}),
    });
    return c.json({ offer });
  });

  r.get('/offers/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const offerId = Number(c.req.param('id'));
    if (!Number.isInteger(offerId)) return c.json({ error: 'Unknown offer.' }, 400);
    const offer = await readOffer(db, scope(c as never), offerId);
    if (!offer) return c.json({ error: 'No such offer in this workspace.' }, 404);
    return c.json({ offer });
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
    const input = await parseBody(c, SendOfferBody);
    const actor = await resolveActorFromContext(c.env as Env, db, c);
    const sent = await sendOffer(db, c.env as Env, {
      tenantId: scope(c as never),
      offerId,
      parties: input.parties,
      ...(input.remindAfterDays !== undefined ? { remindAfterDays: input.remindAfterDays } : {}),
      createdBy: c.get('userId') ?? null,
      actor,
    });
    return c.json(sent);
  });

  r.post('/offers/:id/respond', requireRole(TenantRole.MANAGER), async (c) => {
    const offerId = Number(c.req.param('id'));
    if (!Number.isInteger(offerId)) return c.json({ error: 'Unknown offer.' }, 400);
    const input = await parseBody(c, RespondBody);
    const actor = await resolveActorFromContext(c.env as Env, db, c);
    return c.json(await respondToOffer(db, c.env as Env, {
      tenantId: scope(c as never),
      offerId,
      response: input.response,
      note: input.note ?? null,
      actor,
    }));
  });

  return r;
}
