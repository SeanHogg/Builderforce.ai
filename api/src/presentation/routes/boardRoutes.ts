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
  agentDispatches,
} from '../../infrastructure/database/schema';
import {
  SwimlaneCoordinator,
  TicketCapacityError,
  TicketRunNotFoundError,
  InvalidTicketTransitionError,
} from '../../application/swimlane/SwimlaneCoordinator';
import { DrizzleCoordinatorStore } from '../../application/swimlane/DrizzleCoordinatorStore';
import { DrizzleStageWorkflowRunner } from '../../application/swimlane/stageWorkflowRunner';
import { DrizzlePrdEnsurer } from '../../application/swimlane/DrizzlePrdEnsurer';
import {
  resolveAssignedAgent,
  AssignedAgentNotFoundError,
  type AgentKind,
} from '../../application/swimlane/resolveAssignedAgent';
import { buildDefaultLaneRows, findOrCreateBoard } from '../../application/swimlane/findOrCreateBoard';
import {
  AgentHostStageDispatcher,
  type AgentHostRelayNamespace,
} from '../../application/swimlane/agentHostStageDispatcher';
import type { WorkflowStatus } from '../../application/swimlane/transitions';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const WORKFLOW_STATUSES: WorkflowStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];

/** Env shape we read for agentHost dispatch — AGENT_HOST_RELAY is optional (browser-only works without it). */
type BoardEnv = { AGENT_HOST_RELAY?: AgentHostRelayNamespace };

/** Mutable swimlane fields shared by the create + patch routes. */
interface LaneWriteBody {
  name?: string;
  position?: number;
  isTerminal?: boolean;
  gate?: string;
  executionMode?: string;
  failurePolicy?: string;
  /** Lane action + success quorum (migration 0084). */
  actionType?: string;      // ''|'advance' | 'move_ticket' | 'run_workflow'
  actionTarget?: string;    // lane key (move_ticket) | workflow id (run_workflow)
  successPolicy?: string;   // 'all' | 'any' | 'n_of_m'
  successThreshold?: number;
}

export function createBoardRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Built per-request so the agentHost dispatcher is bound to this request's env.
  const mkCoordinator = (env: unknown): SwimlaneCoordinator =>
    new SwimlaneCoordinator(
      new DrizzleCoordinatorStore(db),
      new AgentHostStageDispatcher((env as BoardEnv)?.AGENT_HOST_RELAY),
      new DrizzleStageWorkflowRunner(db),
      new DrizzlePrdEnsurer(db, env as Env),
    );

  // ── Boards CRUD ───────────────────────────────────────────────────────────

  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      projectId: number;
      name: string;
      maxConcurrentTickets?: number;
      needsAttentionLane?: string;
      segmentId?: string;
      /** Seed the standard status-mirroring swimlanes (default true). */
      seedDefaultLanes?: boolean;
    }>();

    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    if (!body.projectId) return c.json({ error: 'projectId is required' }, 400);

    // One board per project (UNIQUE(project_id), migration 0111): find-or-create
    // rather than blindly inserting, so a repeat create returns the existing board
    // instead of failing the constraint or accruing a duplicate. The shared
    // findOrCreateBoard service seeds the default status-mirroring lanes on first
    // creation (lanes mirror the kanban's task statuses) and is reused by every
    // create entry point so the paths can never drift apart.
    const { board, created } = await findOrCreateBoard(db, {
      tenantId,
      projectId: body.projectId,
      name: body.name,
      segmentId: body.segmentId ?? c.get('segmentId') ?? null,
      maxConcurrentTickets: body.maxConcurrentTickets,
      needsAttentionLane: body.needsAttentionLane,
      seedDefaultLanes: body.seedDefaultLanes,
    });

    return c.json(board, created ? 201 : 200);
  });

  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    // Stable order: the frontend resolves a project's board with `find(byProjectId)`,
    // and both the kanban and the config panel must pick the same one when a
    // project happens to have more than one board. Without an explicit order the
    // (HTTP) row order is non-deterministic, so the two could disagree.
    const rows = await db
      .select()
      .from(boards)
      .where(eq(boards.tenantId, tenantId))
      .orderBy(asc(boards.createdAt), asc(boards.id));
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
      maxConcurrentTickets?: number;
      needsAttentionLane?: string;
      standupTurnMode?: string;
      standupTurnSeconds?: number;
    }>();

    await db
      .update(boards)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.maxConcurrentTickets !== undefined ? { maxConcurrentTickets: body.maxConcurrentTickets } : {}),
        ...(body.needsAttentionLane !== undefined ? { needsAttentionLane: body.needsAttentionLane } : {}),
        ...(body.standupTurnMode !== undefined ? { standupTurnMode: body.standupTurnMode } : {}),
        ...(body.standupTurnSeconds !== undefined ? { standupTurnSeconds: body.standupTurnSeconds } : {}),
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

  // Heal a board that has no swimlanes by seeding the default status-mirroring
  // set. Idempotent: when the board already has lanes it returns them untouched,
  // so it never fights a board whose lanes were deliberately customised. Covers
  // boards left empty by a pre-transaction creation failure (the "config panel
  // says No swimlanes yet, board still shows columns" bug). onConflictDoNothing
  // guards the UNIQUE(board_id, key) constraint if two heals race.
  router.post('/:boardId/swimlanes/ensure-defaults', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const [board] = await db
      .select({ id: boards.id, segmentId: boards.segmentId })
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));
    if (!board) return c.json({ error: 'Board not found' }, 404);

    const existing = await db
      .select()
      .from(swimlanes)
      .where(and(eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)))
      .orderBy(asc(swimlanes.position));
    if (existing.length > 0) return c.json({ swimlanes: existing, seeded: false });

    const now = new Date();
    await db
      .insert(swimlanes)
      .values(buildDefaultLaneRows(tenantId, board.segmentId ?? null, boardId, now))
      .onConflictDoNothing();

    const lanes = await db
      .select()
      .from(swimlanes)
      .where(and(eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)))
      .orderBy(asc(swimlanes.position));
    return c.json({ swimlanes: lanes, seeded: true });
  });

  router.post('/:boardId/swimlanes', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    if (!(await assertBoard(tenantId, boardId))) return c.json({ error: 'Board not found' }, 404);

    const body = await c.req.json<LaneWriteBody & { key: string; name: string }>();
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
        actionType: body.actionType ?? null,
        actionTarget: body.actionTarget ?? null,
        successPolicy: body.successPolicy ?? 'all',
        successThreshold: body.successThreshold ?? null,
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

    const body = await c.req.json<LaneWriteBody>();

    await db
      .update(swimlanes)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.isTerminal !== undefined ? { isTerminal: body.isTerminal } : {}),
        ...(body.gate !== undefined ? { gate: body.gate } : {}),
        ...(body.executionMode !== undefined ? { executionMode: body.executionMode } : {}),
        ...(body.failurePolicy !== undefined ? { failurePolicy: body.failurePolicy } : {}),
        ...(body.actionType !== undefined ? { actionType: body.actionType || null } : {}),
        ...(body.actionTarget !== undefined ? { actionTarget: body.actionTarget || null } : {}),
        ...(body.successPolicy !== undefined ? { successPolicy: body.successPolicy } : {}),
        ...(body.successThreshold !== undefined ? { successThreshold: body.successThreshold } : {}),
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
      // New model: pick a registry agent; runtime/target/model are resolved from it.
      agentKind?: AgentKind;
      agentRef?: string;
      // Optional overrides applied on top of the resolved registry agent: a
      // display `name` for this lane's slot and a `role` (e.g. QA, Reviewer) the
      // SwimlaneCoordinator dispatches under. Blank = keep the agent's defaults.
      name?: string;
      // Legacy model: explicit free-text role + runtime/target (back-compat).
      role?: string;
      runtime?: string;
      target?: string;
      taskTemplate?: string;
      requiredCapabilities?: unknown;
      model?: string;
      position?: number;
    }>();

    // Resolve the chosen registry agent (runtime/host/model defaults) at assign
    // time so the dispatch pipeline keeps reading plain columns. Falls back to
    // the legacy free-text role path when no registry agent is supplied.
    let resolved: {
      agentKind: AgentKind | null;
      agentRef: string | null;
      name: string | null;
      role: string;
      runtime: string;
      target: string | null;
      model: string | null;
    };
    if (body.agentKind && body.agentRef) {
      try {
        const r = await resolveAssignedAgent(db, tenantId, {
          agentKind: body.agentKind,
          agentRef: body.agentRef,
          modelOverride: body.model ?? null,
        });
        resolved = {
          agentKind: body.agentKind,
          agentRef: body.agentRef,
          // Per-lane overrides win over the registry defaults so the same agent
          // can be pinned to a lane under a custom name/role (e.g. "QA").
          name: body.name?.trim() || r.name,
          role: body.role?.trim() || r.role,
          runtime: r.runtime,
          target: r.target,
          model: r.model,
        };
      } catch (err) {
        if (err instanceof AssignedAgentNotFoundError) return c.json({ error: err.message }, 404);
        throw err;
      }
    } else if (body.role?.trim()) {
      resolved = {
        agentKind: null,
        agentRef: null,
        name: null,
        role: body.role.trim(),
        runtime: body.runtime ?? 'cloud',
        target: body.target ?? null,
        model: body.model ?? null,
      };
    } else {
      return c.json({ error: 'agentKind+agentRef (or a legacy role) is required' }, 400);
    }

    const [row] = await db
      .insert(swimlaneAgentAssignments)
      .values({
        tenantId,
        segmentId: c.get('segmentId') ?? null,
        swimlaneId: laneId,
        agentKind: resolved.agentKind,
        agentRef: resolved.agentRef,
        name: resolved.name,
        role: resolved.role,
        runtime: resolved.runtime,
        target: resolved.target,
        taskTemplate: body.taskTemplate ?? null,
        requiredCapabilities:
          body.requiredCapabilities != null ? JSON.stringify(body.requiredCapabilities) : null,
        model: resolved.model,
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

  // Live per-agent dispatch status across the board's tickets, in ONE query
  // (joined to the assignment for the display name) so the board can surface a
  // status pill per task without an N+1. NOT cached: dispatch status is volatile
  // live-execution state — caching it would show stale pending/running pills.
  router.get('/:boardId/dispatches', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    if (!(await assertBoard(tenantId, boardId))) return c.json({ error: 'Board not found' }, 404);
    const rows = await db
      .select({
        id: agentDispatches.id,
        ticketRunId: agentDispatches.ticketRunId,
        taskId: agentDispatches.taskId,
        swimlaneId: agentDispatches.swimlaneId,
        assignmentId: agentDispatches.assignmentId,
        status: agentDispatches.status,
        role: agentDispatches.role,
        name: swimlaneAgentAssignments.name,
        stageSeq: agentDispatches.stageSeq,
        position: agentDispatches.position,
        updatedAt: agentDispatches.updatedAt,
      })
      .from(agentDispatches)
      .innerJoin(ticketRuns, eq(agentDispatches.ticketRunId, ticketRuns.id))
      .leftJoin(swimlaneAgentAssignments, eq(agentDispatches.assignmentId, swimlaneAgentAssignments.id))
      .where(and(eq(ticketRuns.boardId, boardId), eq(agentDispatches.tenantId, tenantId)))
      .orderBy(asc(agentDispatches.ticketRunId), asc(agentDispatches.stageSeq), asc(agentDispatches.position));
    return c.json({ dispatches: rows });
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
