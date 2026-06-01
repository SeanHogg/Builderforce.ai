/**
 * Board routes – /api/boards
 *
 * Agentic swimlane boards: a board is an ordered list of swimlanes (stages),
 * each swimlane has 1..N agent assignments, and a "ticket" (a task) flows
 * through the lanes driven by the SwimlaneCoordinator lifecycle state machine.
 *
 * Boards CRUD:
 *   POST   /api/boards                                  Create a board
 *   GET    /api/boards                                  List boards
 *   GET    /api/boards/:boardId                         Board detail (+lanes)
 *   PATCH  /api/boards/:boardId                         Update a board
 *   DELETE /api/boards/:boardId                         Delete a board
 *
 * Swimlanes (nested):
 *   GET    /api/boards/:boardId/swimlanes               List lanes
 *   POST   /api/boards/:boardId/swimlanes               Create a lane
 *   PATCH  /api/boards/:boardId/swimlanes/:laneId       Update a lane
 *   DELETE /api/boards/:boardId/swimlanes/:laneId       Delete a lane
 *
 * Agent assignments (nested under a lane):
 *   GET    /api/boards/:boardId/swimlanes/:laneId/agents          List assignments
 *   POST   /api/boards/:boardId/swimlanes/:laneId/agents          Add assignment
 *   DELETE /api/boards/:boardId/swimlanes/:laneId/agents/:id      Remove assignment
 *
 * Tickets (lifecycle):
 *   POST   /api/boards/:boardId/tickets                 Start a ticket via coordinator
 *   GET    /api/boards/:boardId/tickets                 List ticket runs
 *   POST   /api/boards/tickets/:ticketRunId/advance     Report stage complete -> advance
 *   POST   /api/boards/tickets/:ticketRunId/approve     Approve a gate
 *   POST   /api/boards/tickets/:ticketRunId/retry       Retry a failed stage
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  boards,
  swimlanes,
  swimlaneAgentAssignments,
  ticketRuns,
} from '../../infrastructure/database/schema';
import {
  SwimlaneCoordinator,
  TicketCapacityError,
  TicketRunNotFoundError,
  InvalidTicketTransitionError,
} from '../../application/swimlane/SwimlaneCoordinator';
import { DrizzleCoordinatorStore } from '../../application/swimlane/DrizzleCoordinatorStore';
import {
  ClawStageDispatcher,
  type ClawRelayNamespace,
} from '../../application/swimlane/clawStageDispatcher';
import type { WorkflowStatus } from '../../application/swimlane/transitions';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const WORKFLOW_STATUSES: WorkflowStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];

/** Env shape we read for claw dispatch — CLAW_RELAY is optional (browser-only works without it). */
type BoardEnv = { CLAW_RELAY?: ClawRelayNamespace };

export function createBoardRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Built per-request so the claw dispatcher is bound to this request's env.
  const mkCoordinator = (env: unknown): SwimlaneCoordinator =>
    new SwimlaneCoordinator(
      new DrizzleCoordinatorStore(db),
      new ClawStageDispatcher((env as BoardEnv)?.CLAW_RELAY),
    );

  // ── Boards CRUD ───────────────────────────────────────────────────────────

  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      projectId: number;
      name: string;
      autonomous?: boolean;
      maxConcurrentTickets?: number;
      needsAttentionLane?: string;
      segmentId?: string;
    }>();

    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    if (!body.projectId) return c.json({ error: 'projectId is required' }, 400);

    const now = new Date();
    const [row] = await db
      .insert(boards)
      .values({
        tenantId,
        segmentId: body.segmentId ?? c.get('segmentId') ?? null,
        projectId: body.projectId,
        name: body.name.trim(),
        autonomous: body.autonomous ?? false,
        maxConcurrentTickets: body.maxConcurrentTickets ?? 5,
        needsAttentionLane: body.needsAttentionLane ?? 'needs-attention',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return c.json(row, 201);
  });

  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db.select().from(boards).where(eq(boards.tenantId, tenantId));
    return c.json({ boards: rows });
  });

  router.get('/:boardId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const [board] = await db
      .select()
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));
    if (!board) return c.json({ error: 'Board not found' }, 404);

    const lanes = await db
      .select()
      .from(swimlanes)
      .where(and(eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)))
      .orderBy(asc(swimlanes.position));
    return c.json({ ...board, swimlanes: lanes });
  });

  router.patch('/:boardId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const body = await c.req.json<{
      name?: string;
      autonomous?: boolean;
      maxConcurrentTickets?: number;
      needsAttentionLane?: string;
    }>();

    await db
      .update(boards)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.autonomous !== undefined ? { autonomous: body.autonomous } : {}),
        ...(body.maxConcurrentTickets !== undefined ? { maxConcurrentTickets: body.maxConcurrentTickets } : {}),
        ...(body.needsAttentionLane !== undefined ? { needsAttentionLane: body.needsAttentionLane } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));

    const [row] = await db.select().from(boards).where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Board not found' }, 404);
    return c.json(row);
  });

  router.delete('/:boardId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    await db.delete(boards).where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));
    return c.body(null, 204);
  });

  // ── Swimlanes (nested) ────────────────────────────────────────────────────

  async function assertBoard(tenantId: number, boardId: string): Promise<boolean> {
    const [board] = await db
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));
    return Boolean(board);
  }

  router.get('/:boardId/swimlanes', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    if (!(await assertBoard(tenantId, boardId))) return c.json({ error: 'Board not found' }, 404);
    const lanes = await db
      .select()
      .from(swimlanes)
      .where(and(eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)))
      .orderBy(asc(swimlanes.position));
    return c.json({ swimlanes: lanes });
  });

  router.post('/:boardId/swimlanes', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    if (!(await assertBoard(tenantId, boardId))) return c.json({ error: 'Board not found' }, 404);

    const body = await c.req.json<{
      key: string;
      name: string;
      position?: number;
      isTerminal?: boolean;
      gate?: string;
      executionMode?: string;
      failurePolicy?: string;
    }>();
    if (!body.key?.trim()) return c.json({ error: 'key is required' }, 400);
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);

    const now = new Date();
    const [row] = await db
      .insert(swimlanes)
      .values({
        tenantId,
        segmentId: c.get('segmentId') ?? null,
        boardId,
        key: body.key.trim(),
        name: body.name.trim(),
        position: body.position ?? 0,
        isTerminal: body.isTerminal ?? false,
        gate: body.gate ?? 'auto',
        executionMode: body.executionMode ?? 'sequential',
        failurePolicy: body.failurePolicy ?? 'needs_attention',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return c.json(row, 201);
  });

  router.patch('/:boardId/swimlanes/:laneId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const laneId = c.req.param('laneId');

    const body = await c.req.json<{
      name?: string;
      position?: number;
      isTerminal?: boolean;
      gate?: string;
      executionMode?: string;
      failurePolicy?: string;
    }>();

    await db
      .update(swimlanes)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.isTerminal !== undefined ? { isTerminal: body.isTerminal } : {}),
        ...(body.gate !== undefined ? { gate: body.gate } : {}),
        ...(body.executionMode !== undefined ? { executionMode: body.executionMode } : {}),
        ...(body.failurePolicy !== undefined ? { failurePolicy: body.failurePolicy } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(swimlanes.id, laneId), eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)));

    const [row] = await db
      .select()
      .from(swimlanes)
      .where(and(eq(swimlanes.id, laneId), eq(swimlanes.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Swimlane not found' }, 404);
    return c.json(row);
  });

  router.delete('/:boardId/swimlanes/:laneId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const laneId = c.req.param('laneId');
    await db
      .delete(swimlanes)
      .where(and(eq(swimlanes.id, laneId), eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)));
    return c.body(null, 204);
  });

  // ── Agent assignments (nested under a lane) ────────────────────────────────

  async function assertLane(tenantId: number, boardId: string, laneId: string): Promise<boolean> {
    const [lane] = await db
      .select({ id: swimlanes.id })
      .from(swimlanes)
      .where(and(eq(swimlanes.id, laneId), eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)));
    return Boolean(lane);
  }

  router.get('/:boardId/swimlanes/:laneId/agents', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const laneId = c.req.param('laneId');
    if (!(await assertLane(tenantId, boardId, laneId))) return c.json({ error: 'Swimlane not found' }, 404);
    const rows = await db
      .select()
      .from(swimlaneAgentAssignments)
      .where(and(eq(swimlaneAgentAssignments.swimlaneId, laneId), eq(swimlaneAgentAssignments.tenantId, tenantId)))
      .orderBy(asc(swimlaneAgentAssignments.position));
    return c.json({ assignments: rows });
  });

  router.post('/:boardId/swimlanes/:laneId/agents', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const laneId = c.req.param('laneId');
    if (!(await assertLane(tenantId, boardId, laneId))) return c.json({ error: 'Swimlane not found' }, 404);

    const body = await c.req.json<{
      role: string;
      runtime?: string;
      target?: string;
      taskTemplate?: string;
      requiredCapabilities?: unknown;
      model?: string;
      position?: number;
    }>();
    if (!body.role?.trim()) return c.json({ error: 'role is required' }, 400);

    const [row] = await db
      .insert(swimlaneAgentAssignments)
      .values({
        tenantId,
        segmentId: c.get('segmentId') ?? null,
        swimlaneId: laneId,
        role: body.role.trim(),
        runtime: body.runtime ?? 'cloud',
        target: body.target ?? null,
        taskTemplate: body.taskTemplate ?? null,
        requiredCapabilities:
          body.requiredCapabilities != null ? JSON.stringify(body.requiredCapabilities) : null,
        model: body.model ?? null,
        position: body.position ?? 0,
        createdAt: new Date(),
      })
      .returning();
    return c.json(row, 201);
  });

  router.delete('/:boardId/swimlanes/:laneId/agents/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const laneId = c.req.param('laneId');
    const id = c.req.param('id');
    await db
      .delete(swimlaneAgentAssignments)
      .where(
        and(
          eq(swimlaneAgentAssignments.id, id),
          eq(swimlaneAgentAssignments.swimlaneId, laneId),
          eq(swimlaneAgentAssignments.tenantId, tenantId),
        ),
      );
    return c.body(null, 204);
  });

  // ── Tickets (lifecycle) ────────────────────────────────────────────────────

  router.post('/:boardId/tickets', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    if (!(await assertBoard(tenantId, boardId))) return c.json({ error: 'Board not found' }, 404);

    const body = await c.req.json<{ taskId: number }>();
    if (!body.taskId) return c.json({ error: 'taskId is required' }, 400);

    try {
      const run = await mkCoordinator(c.env).startTicket(boardId, body.taskId, tenantId);
      return c.json(run, 201);
    } catch (err) {
      if (err instanceof TicketCapacityError) {
        return c.json({ error: err.message, code: 'capacity_exceeded' }, 409);
      }
      if (err instanceof TicketRunNotFoundError) {
        return c.json({ error: 'Board not found' }, 404);
      }
      throw err;
    }
  });

  router.get('/:boardId/tickets', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    if (!(await assertBoard(tenantId, boardId))) return c.json({ error: 'Board not found' }, 404);
    const rows = await db
      .select()
      .from(ticketRuns)
      .where(and(eq(ticketRuns.boardId, boardId), eq(ticketRuns.tenantId, tenantId)))
      .orderBy(asc(ticketRuns.createdAt));
    return c.json({ tickets: rows });
  });

  // Verify a ticket run belongs to the tenant before mutating it.
  async function assertTicketRun(tenantId: number, ticketRunId: string): Promise<boolean> {
    const [run] = await db
      .select({ id: ticketRuns.id })
      .from(ticketRuns)
      .where(and(eq(ticketRuns.id, ticketRunId), eq(ticketRuns.tenantId, tenantId)));
    return Boolean(run);
  }

  router.post('/tickets/:ticketRunId/advance', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const ticketRunId = c.req.param('ticketRunId');
    if (!(await assertTicketRun(tenantId, ticketRunId))) return c.json({ error: 'Ticket run not found' }, 404);

    const body = await c.req.json<{ workflowStatus: WorkflowStatus }>().catch(() => ({ workflowStatus: 'completed' as WorkflowStatus }));
    const status = body.workflowStatus ?? 'completed';
    if (!WORKFLOW_STATUSES.includes(status)) {
      return c.json({ error: `workflowStatus must be one of ${WORKFLOW_STATUSES.join(', ')}` }, 400);
    }

    try {
      const run = await mkCoordinator(c.env).onStageComplete(ticketRunId, status);
      return c.json(run);
    } catch (err) {
      return handleCoordinatorError(c, err);
    }
  });

  router.post('/tickets/:ticketRunId/approve', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const ticketRunId = c.req.param('ticketRunId');
    if (!(await assertTicketRun(tenantId, ticketRunId))) return c.json({ error: 'Ticket run not found' }, 404);
    try {
      const run = await mkCoordinator(c.env).approveGate(ticketRunId);
      return c.json(run);
    } catch (err) {
      return handleCoordinatorError(c, err);
    }
  });

  router.post('/tickets/:ticketRunId/retry', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const ticketRunId = c.req.param('ticketRunId');
    if (!(await assertTicketRun(tenantId, ticketRunId))) return c.json({ error: 'Ticket run not found' }, 404);
    try {
      const run = await mkCoordinator(c.env).retryStage(ticketRunId);
      return c.json(run);
    } catch (err) {
      return handleCoordinatorError(c, err);
    }
  });

  return router;
}

function handleCoordinatorError(c: Context<HonoEnv>, err: unknown): Response {
  if (err instanceof TicketRunNotFoundError) {
    return c.json({ error: 'Ticket run not found' }, 404);
  }
  if (err instanceof InvalidTicketTransitionError) {
    return c.json({ error: err.message, code: 'invalid_transition' }, 409);
  }
  if (err instanceof TicketCapacityError) {
    return c.json({ error: err.message, code: 'capacity_exceeded' }, 409);
  }
  throw err;
}
