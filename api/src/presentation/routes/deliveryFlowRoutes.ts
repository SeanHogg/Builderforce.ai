/**
 * Commitments, estimates, sprint economics and the approval chain (PRD 19 §9).
 *
 * Four capabilities in one router because they are one workflow — a ceremony
 * produces commitments, commitments get estimated, estimates roll into what a
 * sprint cost, and anything expensive goes through an approval chain. Splitting
 * them across four routers would mean four mounts for one screen.
 *
 *   GET    /api/delivery-flow/action-items              open commitments        member
 *   POST   /api/delivery-flow/action-items              capture one             member
 *   PATCH  /api/delivery-flow/action-items/:id          edit / close            member
 *   POST   /api/delivery-flow/action-items/:id/promote  -> a work item          member
 *   GET    /api/delivery-flow/action-items/overdue      the standup's agenda    member
 *   GET    /api/delivery-flow/action-items/follow-through?sourceRef=  did we keep them
 *
 *   GET    /api/delivery-flow/estimates/:workItemRef    current + history       member
 *   POST   /api/delivery-flow/estimates                 record one              member
 *   GET    /api/delivery-flow/estimates-accuracy        spread by estimator     member
 *
 *   GET    /api/delivery-flow/sprints/:sprintRef/cost   what it cost            member
 *   PUT    /api/delivery-flow/sprints/:sprintRef/cost   stamp it                MANAGER
 *   GET    /api/delivery-flow/sprint-cost-trend         the trend line          member
 *
 *   GET    /api/delivery-flow/approvals/queue           what I must decide      member
 *   GET    /api/delivery-flow/approvals/:kind/:ref      the chain and verdict    member
 *   POST   /api/delivery-flow/approvals/:kind/:ref      open a chain            MANAGER
 *   POST   /api/delivery-flow/approvals/:kind/:ref/act  approve / reject        member
 *   DELETE /api/delivery-flow/approvals/:kind/:ref      withdraw it             MANAGER
 *
 * Capturing a commitment and acting on an approval are MEMBER: a chain whose
 * approvers must all be managers is not a chain, and a retro where only managers
 * may record an action item records nothing. Opening a chain and stamping a
 * sprint's cost are MANAGER, because both assert something about other people's
 * work.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import {
  ActionItemError,
  createActionItem,
  listActionItems,
  overdueActionItems,
  promoteToWorkItem,
  sourceFollowThrough,
  updateActionItem,
  type ActionStatus,
} from '../../application/delivery/actionItems';
import {
  AgileCostError,
  costTrend,
  currentEstimate,
  estimateAccuracy,
  estimateHistory,
  recordEstimate,
  sprintEconomics,
  stampSprintCost,
  type EstimateUnit,
} from '../../application/delivery/agileCost';
import {
  ApprovalChainError,
  act,
  cancelChain,
  chainState,
  openChain,
  queueFor,
  type Approver,
} from '../../application/approval/approvalChain';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ActionItemError || error instanceof AgileCostError || error instanceof ApprovalChainError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

const rowId = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw new ActionItemError('That is not an id.', 400);
  return Math.floor(id);
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const when = (v: unknown): Date | null | undefined => {
  if (v === null) return null;
  const s = str(v);
  if (s === undefined) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new ActionItemError('That is not a date.', 400);
  return d;
};

export function createDeliveryFlowRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const manager = requireRole(TenantRole.MANAGER);
  const tenant = (c: { get: (k: string) => unknown }) => c.get('tenantId') as number;
  const who = async (c: Parameters<typeof resolveActorFromContext>[2] & { env: unknown }) =>
    resolveActorFromContext(c.env as Env, db, c);

  // ── Action items ──────────────────────────────────────────────────────────
  // The two literal paths are declared BEFORE `/action-items/:id` so they are not
  // swallowed as ids — Hono matches in registration order.

  router.get('/action-items/overdue', (c) => handle(async () =>
    Response.json({ items: await overdueActionItems(db, tenant(c)) })));

  router.get('/action-items/follow-through', (c) => handle(async () => {
    const ref = c.req.query('sourceRef');
    if (!ref) throw new ActionItemError('sourceRef is required', 400);
    return Response.json(await sourceFollowThrough(db, tenant(c), { ref }));
  }));

  router.get('/action-items', (c) => handle(async () => {
    const sourceRef = c.req.query('sourceRef');
    const ownerRef = c.req.query('ownerRef');
    return Response.json({
      items: await listActionItems(db, tenant(c), {
        ...(sourceRef ? { source: { ref: sourceRef } } : {}),
        ...(ownerRef ? { ownerRef } : {}),
        openOnly: c.req.query('all') !== '1',
      }),
    });
  }));

  router.post('/action-items', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const sourceRef = str(body.sourceRef);
    const item = await createActionItem(
      db, c.env as Env, tenant(c), await who(c),
      {
        title: String(body.title ?? ''),
        detail: str(body.detail) ?? null,
        ownerRef: str(body.ownerRef) ?? null,
        dueAt: when(body.dueAt) ?? null,
        ...(sourceRef ? { source: { ref: sourceRef } } : {}),
      },
      (c.get('userId') as string | undefined) ?? null,
    );
    return Response.json(item, { status: 201 });
  }));

  router.patch('/action-items/:id', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = String(body.title);
    if (body.detail !== undefined) patch.detail = str(body.detail) ?? null;
    if (body.ownerRef !== undefined) patch.ownerRef = str(body.ownerRef) ?? null;
    if (body.dueAt !== undefined) patch.dueAt = when(body.dueAt) ?? null;
    if (body.status !== undefined) patch.status = String(body.status) as ActionStatus;
    return Response.json(await updateActionItem(
      db, c.env as Env, tenant(c), await who(c), rowId(c.req.param('id')), patch,
    ));
  }));

  router.post('/action-items/:id/promote', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await promoteToWorkItem(
      db, c.env as Env, tenant(c), await who(c),
      rowId(c.req.param('id')), String(body.workItemRef ?? ''),
    ));
  }));

  // ── Estimates ─────────────────────────────────────────────────────────────

  router.get('/estimates-accuracy', (c) => handle(async () =>
    Response.json({ byEstimator: await estimateAccuracy(db, tenant(c)) })));

  router.get('/estimates/:workItemRef', (c) => handle(async () => {
    const ref = c.req.param('workItemRef');
    const [current, history] = await Promise.all([
      currentEstimate(db, tenant(c), ref),
      estimateHistory(db, tenant(c), ref),
    ]);
    return Response.json({ current, history });
  }));

  router.post('/estimates', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await recordEstimate(db, tenant(c), {
      workItemRef: String(body.workItemRef ?? ''),
      ...(str(body.unit) !== undefined ? { unit: str(body.unit) as EstimateUnit } : {}),
      value: num(body.value) ?? null,
      tshirt: str(body.tshirt) ?? null,
      ...(body.estimatorKind === 'agent' ? { estimatorKind: 'agent' as const } : {}),
      estimatorRef: str(body.estimatorRef) ?? (c.get('userId') as string | undefined) ?? null,
      confidence: num(body.confidence) ?? null,
    }), { status: 201 });
  }));

  // ── Sprint economics ──────────────────────────────────────────────────────

  router.get('/sprint-cost-trend', (c) => handle(async () => {
    const projectRef = c.req.query('projectRef');
    return Response.json({ sprints: await costTrend(db, tenant(c), projectRef) });
  }));

  router.get('/sprints/:sprintRef/cost', (c) => handle(async () => {
    const economics = await sprintEconomics(db, tenant(c), c.req.param('sprintRef'));
    if (!economics) return Response.json({ error: 'No cost has been stamped for that sprint.' }, { status: 404 });
    return Response.json(economics);
  }));

  router.put('/sprints/:sprintRef/cost', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await stampSprintCost(db, c.env as Env, tenant(c), await who(c), {
      sprintRef: c.req.param('sprintRef'),
      projectRef: str(body.projectRef) ?? null,
      ...(num(body.laborCost) !== undefined ? { laborCost: num(body.laborCost) as number } : {}),
      ...(num(body.toolingCost) !== undefined ? { toolingCost: num(body.toolingCost) as number } : {}),
      ...(num(body.aiCost) !== undefined ? { aiCost: num(body.aiCost) as number } : {}),
      deliveredValue: num(body.deliveredValue) ?? null,
      ...(str(body.currency) !== undefined ? { currency: str(body.currency) as string } : {}),
    }));
  }));

  // ── Approval chain ────────────────────────────────────────────────────────

  router.get('/approvals/queue', (c) => handle(async () =>
    Response.json({
      queue: await queueFor(db, tenant(c), String(c.req.query('approverRef') ?? c.get('userId') ?? '')),
    })));

  router.get('/approvals/:kind/:ref', (c) => handle(async () =>
    Response.json(await chainState(db, tenant(c), { kind: c.req.param('kind'), ref: c.req.param('ref') }))));

  router.post('/approvals/:kind/:ref', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const raw = Array.isArray(body.approvers) ? body.approvers : [];
    const approvers: Approver[] = raw.map((a) => {
      const o = a as Record<string, unknown>;
      return {
        ref: String(o.ref ?? ''),
        ...(o.kind === 'role' || o.kind === 'agent' ? { kind: o.kind } : {}),
        ...(num(o.step) !== undefined ? { step: num(o.step) as number } : {}),
      };
    });
    return Response.json(await openChain(
      db, c.env as Env, tenant(c), await who(c),
      { kind: c.req.param('kind'), ref: c.req.param('ref') }, approvers,
    ), { status: 201 });
  }));

  router.post('/approvals/:kind/:ref/act', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    if (typeof body.approved !== 'boolean') {
      throw new ApprovalChainError('approved must be true or false', 400);
    }
    return Response.json(await act(
      db, c.env as Env, tenant(c), await who(c),
      { kind: c.req.param('kind'), ref: c.req.param('ref') },
      String(body.approverRef ?? c.get('userId') ?? ''),
      body.approved,
    ));
  }));

  router.delete('/approvals/:kind/:ref', manager, (c) => handle(async () =>
    Response.json(await cancelChain(
      db, c.env as Env, tenant(c), await who(c),
      { kind: c.req.param('kind'), ref: c.req.param('ref') },
    ))));

  return router;
}
