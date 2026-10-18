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
 *   POST   /api/delivery-flow/action-items/:id/promote  -> a ticket {taskId}    member
 *   GET    /api/delivery-flow/action-items/overdue      the standup's agenda    member
 *   GET    /api/delivery-flow/action-items/follow-through?sourceRef=  did we keep them
 *
 *   GET    /api/delivery-flow/estimates/:taskId         current + history       member
 *   POST   /api/delivery-flow/estimates                 record one {taskId}     member
 *   GET    /api/delivery-flow/estimates-accuracy        spread by estimator     member
 *
 *   GET    /api/delivery-flow/sprints/:sprintId/cost    what it cost            member
 *   PUT    /api/delivery-flow/sprints/:sprintId/cost    stamp it                MANAGER
 *   GET    /api/delivery-flow/sprint-cost-trend?projectId=  the trend line      member
 *
 * The work item a commitment is promoted to, and the one an estimate is ON, is a
 * `tasks` row addressed by its id (the spec's PM spine unified onto `tasks`,
 * decided 2026-09-12); a sprint is a `sprints` row addressed by its uuid.
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
  promoteToTask,
  sourceFollowThrough,
  updateActionItem,
  type ActionStatus,
} from '../../application/delivery/actionItems';
import {
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
import { positiveIntParam } from './queryParams';
import { parseBody, z, zJsonObject } from './requestBody';
import { rowId, str, num, whenPatch } from '../../domain/shared/coerce';
import { requireTenantId } from '../middleware/tenantContext';

/**
 * Most writes here read their body field by field through `str` / `num` /
 * `when` / `String(...)` and let the application layer own the rules, so the
 * shape asserted is "a JSON object" — an array or scalar is a 400, not a TypeError.
 */
const DeliveryWriteBody = zJsonObject;

/**
 * Opening a chain reads each approver's `ref` / `kind` / `step` off an OBJECT, so
 * each entry must be one (a `null` entry used to be a TypeError). A missing or
 * null list is still the empty chain `openChain` refuses in its own words.
 */
const OpenChainBody = z.object({
  approvers: z.array(zJsonObject).nullish(),
});


export function createDeliveryFlowRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const manager = requireRole(TenantRole.MANAGER);
  const tenant = (c: { get: (k: string) => unknown }) => requireTenantId(c);
  const who = async (c: Parameters<typeof resolveActorFromContext>[2] & { env: unknown }) =>
    resolveActorFromContext(c.env as Env, db, c);

  // ── Action items ──────────────────────────────────────────────────────────
  // The two literal paths are declared BEFORE `/action-items/:id` so they are not
  // swallowed as ids — Hono matches in registration order.

  router.get('/action-items/overdue', async (c) =>
    Response.json({ items: await overdueActionItems(db, tenant(c)) }));

  router.get('/action-items/follow-through', async (c) => {
    const ref = c.req.query('sourceRef');
    if (!ref) throw new ActionItemError('sourceRef is required', 400);
    return Response.json(await sourceFollowThrough(db, tenant(c), { ref }));
  });

  router.get('/action-items', async (c) => {
    const sourceRef = c.req.query('sourceRef');
    const ownerRef = c.req.query('ownerRef');
    return Response.json({
      items: await listActionItems(db, tenant(c), {
        ...(sourceRef ? { source: { ref: sourceRef } } : {}),
        ...(ownerRef ? { ownerRef } : {}),
        openOnly: c.req.query('all') !== '1',
      }),
    });
  });

  router.post('/action-items', async (c) => {
    const body = await parseBody(c, DeliveryWriteBody);
    const sourceRef = str(body.sourceRef);
    const item = await createActionItem(
      db, c.env as Env, tenant(c), await who(c),
      {
        title: String(body.title ?? ''),
        detail: str(body.detail) ?? null,
        ownerRef: str(body.ownerRef) ?? null,
        dueAt: whenPatch(body.dueAt) ?? null,
        ...(sourceRef ? { source: { ref: sourceRef } } : {}),
      },
      (c.get('userId') as string | undefined) ?? null,
    );
    return Response.json(item, { status: 201 });
  });

  router.patch('/action-items/:id', async (c) => {
    const body = await parseBody(c, DeliveryWriteBody);
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = String(body.title);
    if (body.detail !== undefined) patch.detail = str(body.detail) ?? null;
    if (body.ownerRef !== undefined) patch.ownerRef = str(body.ownerRef) ?? null;
    if (body.dueAt !== undefined) patch.dueAt = whenPatch(body.dueAt) ?? null;
    if (body.status !== undefined) patch.status = String(body.status) as ActionStatus;
    return Response.json(await updateActionItem(
      db, c.env as Env, tenant(c), await who(c), rowId(c.req.param('id')), patch,
    ));
  });

  router.post('/action-items/:id/promote', async (c) => {
    const body = await parseBody(c, DeliveryWriteBody);
    return Response.json(await promoteToTask(
      db, c.env as Env, tenant(c), await who(c),
      rowId(c.req.param('id')), num(body.taskId) ?? Number.NaN,
    ));
  });

  // ── Estimates ─────────────────────────────────────────────────────────────

  router.get('/estimates-accuracy', async (c) =>
    Response.json({ byEstimator: await estimateAccuracy(db, tenant(c)) }));

  router.get('/estimates/:taskId', async (c) => {
    const taskId = rowId(c.req.param('taskId'));
    const [current, history] = await Promise.all([
      currentEstimate(db, tenant(c), taskId),
      estimateHistory(db, tenant(c), taskId),
    ]);
    return Response.json({ current, history });
  });

  router.post('/estimates', async (c) => {
    const body = await parseBody(c, DeliveryWriteBody);
    return Response.json(await recordEstimate(db, tenant(c), {
      taskId: num(body.taskId) ?? Number.NaN,
      ...(str(body.unit) !== undefined ? { unit: str(body.unit) as EstimateUnit } : {}),
      value: num(body.value) ?? null,
      tshirt: str(body.tshirt) ?? null,
      ...(body.estimatorKind === 'agent' ? { estimatorKind: 'agent' as const } : {}),
      estimatorRef: str(body.estimatorRef) ?? (c.get('userId') as string | undefined) ?? null,
      confidence: num(body.confidence) ?? null,
    }), { status: 201 });
  });

  // ── Sprint economics ──────────────────────────────────────────────────────

  router.get('/sprint-cost-trend', async (c) => {
    const projectId = positiveIntParam(c.req.query('projectId'));
    return Response.json({ sprints: await costTrend(db, tenant(c), projectId) });
  });

  router.get('/sprints/:sprintId/cost', async (c) => {
    const economics = await sprintEconomics(db, tenant(c), c.req.param('sprintId'));
    if (!economics) return Response.json({ error: 'No cost has been stamped for that sprint.' }, { status: 404 });
    return Response.json(economics);
  });

  router.put('/sprints/:sprintId/cost', manager, async (c) => {
    const body = await parseBody(c, DeliveryWriteBody);
    return Response.json(await stampSprintCost(db, c.env as Env, tenant(c), await who(c), {
      sprintId: c.req.param('sprintId'),
      ...(num(body.laborCost) !== undefined ? { laborCost: num(body.laborCost) as number } : {}),
      ...(num(body.toolingCost) !== undefined ? { toolingCost: num(body.toolingCost) as number } : {}),
      ...(num(body.aiCost) !== undefined ? { aiCost: num(body.aiCost) as number } : {}),
      deliveredValue: num(body.deliveredValue) ?? null,
      ...(str(body.currency) !== undefined ? { currency: str(body.currency) as string } : {}),
    }));
  });

  // ── Approval chain ────────────────────────────────────────────────────────

  router.get('/approvals/queue', async (c) =>
    Response.json({
      queue: await queueFor(db, tenant(c), String(c.req.query('approverRef') ?? c.get('userId') ?? '')),
    }));

  router.get('/approvals/:kind/:ref', async (c) =>
    Response.json(await chainState(db, tenant(c), { kind: c.req.param('kind'), ref: c.req.param('ref') })));

  router.post('/approvals/:kind/:ref', manager, async (c) => {
    const body = await parseBody(c, OpenChainBody);
    const raw = body.approvers ?? [];
    const approvers: Approver[] = raw.map((o) => {
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
  });

  router.post('/approvals/:kind/:ref/act', async (c) => {
    const body = await parseBody(c, DeliveryWriteBody);
    if (typeof body.approved !== 'boolean') {
      throw new ApprovalChainError('approved must be true or false', 400);
    }
    return Response.json(await act(
      db, c.env as Env, tenant(c), await who(c),
      { kind: c.req.param('kind'), ref: c.req.param('ref') },
      String(body.approverRef ?? c.get('userId') ?? ''),
      body.approved,
    ));
  });

  router.delete('/approvals/:kind/:ref', manager, async (c) =>
    Response.json(await cancelChain(
      db, c.env as Env, tenant(c), await who(c),
      { kind: c.req.param('kind'), ref: c.req.param('ref') },
    )));

  return router;
}
