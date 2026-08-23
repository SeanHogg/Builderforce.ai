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
 *   PATCH  /api/boards/:boardId/swimlanes/:laneId       Update a lane (incl. RENAME its key)
 *   DELETE /api/boards/:boardId/swimlanes/:laneId       Delete a lane (= merge it away)
 *   GET    /api/boards/:boardId/orphaned-tasks          Tickets in no lane at all
 *   POST   /api/boards/:boardId/orphaned-tasks/adopt    Re-home them onto a lane
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
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { authMiddleware, isManager, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { ForbiddenError } from '../../domain/shared/errors';
import {
  boards,
  swimlanes,
  swimlaneRequirements,
  ticketRuns,
  agentDispatches,
} from '../../infrastructure/database/schema';
import {
  SwimlaneCoordinator,
  TicketCapacityError,
  TicketRunNotFoundError,
  InvalidTicketTransitionError,
} from '../../application/swimlane/SwimlaneCoordinator';
import { makeSwimlaneCoordinator } from '../../application/swimlane/makeCoordinator';
import { backfillLaneResidents } from '../../application/swimlane/laneResidentBackfill';
import {
  resolveAssignedAgent,
  AssignedAgentNotFoundError,
  type AgentKind,
} from '../../application/swimlane/resolveAssignedAgent';
import { buildDefaultLaneRows, findOrCreateBoard } from '../../application/swimlane/findOrCreateBoard';
import {
  adoptOrphanedTasks,
  countOrphanedTasks,
  reassignOrphanedTasksOnLaneDelete,
} from '../../application/swimlane/reassignOrphanedTasks';
import { renameLaneKey, uniqueLaneKey, validateLaneKeyChange } from '../../application/swimlane/laneKey';
import type { AgentHostRelayNamespace } from '../../application/swimlane/agentHostStageDispatcher';
import type { WorkflowStatus } from '../../application/swimlane/transitions';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { enforceCloudRunCap } from '../../application/runtime/cloudRunLedger';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { forLane, laneAgentAssignments, laneAssignmentValues } from '../../application/swimlane/laneAgentAssignments';

const WORKFLOW_STATUSES: WorkflowStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];

/** Env shape we read for agentHost dispatch — AGENT_HOST_RELAY is optional (browser-only works without it). */
type BoardEnv = { AGENT_HOST_RELAY?: AgentHostRelayNamespace };

/** Mutable swimlane fields shared by the create + patch routes. */
interface LaneWriteBody {
  name?: string;
  /**
   * The lane's KEY — the status its tickets hold, not the label a person reads.
   *
   * PATCHable since migration 1115 gave `tasks` a real `swimlane_id`: the lane's
   * residents can now be found by reference, so a rename can carry them (and the
   * board's other lane-key pointers) instead of stranding them. `renameLaneKey`
   * owns that cascade; the route never writes `key` directly.
   */
  key?: string;
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
  /** How strictly this lane's requirements gate entry (migration 0274): off|soft|hard. */
  requirementGate?: string;
  /**
   * PARKED — off the delivery path (migration 1080).
   *
   * Distinct from `isTerminal`: a parked lane does not END the ticket, it steps it out of
   * the flow. `computeCompletion` excludes parked lanes from its rank denominator (a
   * blocked ticket used to report ~87% complete because `Blocked` sits late in the lane
   * order) and `resolveNextLaneKey` refuses to advance INTO one.
   */
  isParking?: boolean;
}

/**
 * The workspace's cloud-run allowance, as ONE fact (DISP-R3).
 *
 * Being over the monthly cap stops autonomy on every ticket on every board,
 * identically. It used to surface only as a per-ticket refusal buried in each
 * card's telemetry, so a board with 200 stalled cards showed 200 unrelated-looking
 * problems and no way to see the single cause. This is the workspace-level answer
 * the board header states once.
 *
 * Cached: a month-to-date aggregate moves slowly relative to a board poll, and one
 * read serves every board in the workspace. A metering hiccup returns null — "we
 * could not tell" is not "you are over", and the enforcement point is the
 * dispatcher, never this display read.
 */
export type CloudRunAllowance =
  | { overAllowance: false }
  | { overAllowance: true; used: number; limit: number; plan: string };

async function readCloudRunAllowance(db: Db, env: Env, tenantId: number): Promise<CloudRunAllowance | null> {
  return getOrSetCached(
    env,
    `board:cloud-run-allowance:t:${tenantId}`,
    async (): Promise<CloudRunAllowance> => {
      const cap = await enforceCloudRunCap(db, tenantId, env);
      // Under allowance the gate returns only `{ allowed: true }` — an unlimited
      // plan has no usage figures, and inventing zeroes would render as "0 of 0".
      return cap.allowed
        ? { overAllowance: false }
        : { overAllowance: true, used: cap.used, limit: cap.limit, plan: cap.effectivePlan };
    },
    { kvTtlSeconds: 60, l1TtlMs: 15_000 },
  ).catch(() => null);
}

export function createBoardRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Built per-request so the agentHost dispatcher is bound to this request's env.
  // ONE factory (see makeCoordinator.ts) — four call sites used to construct this by
  // hand and disagreed on whether the workflow runner was wired.
  const mkCoordinator = (env: unknown): SwimlaneCoordinator => makeSwimlaneCoordinator(db, env);

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
      .orderBy(desc(boards.lifecycleManaged), desc(boards.updatedAt), desc(boards.createdAt), desc(boards.id));
    // Alongside the list, not on each row: it is one workspace fact, and repeating
    // it per board would invite a per-board reading of a per-workspace condition.
    return c.json({ boards: rows, cloudRunAllowance: await readCloudRunAllowance(db, c.env as Env, tenantId) });
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

    return c.json({
      ...board,
      swimlanes: lanes,
      cloudRunAllowance: await readCloudRunAllowance(db, c.env as Env, tenantId),
    });
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
      /** Default per-member WIP cap for the round table's power meter (1084). */
      defaultMemberWipCap?: number;
      hideDoneItems?: boolean;
      requireExecutionApproval?: boolean;
    }>();

    // The execution-approval gate is a governance control: only managers+ may
    // override it (mirrors the <RoleGate capability="board.manageApproval"> UX
    // and the API's requireRole convention). Other board settings stay open to
    // any workspace member, so this is gated per-field rather than on the route.
    if (body.requireExecutionApproval !== undefined && !isManager(c)) {
      throw new ForbiddenError('Only a manager can change the approval requirement for this board');
    }

    await db
      .update(boards)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.maxConcurrentTickets !== undefined ? { maxConcurrentTickets: body.maxConcurrentTickets } : {}),
        ...(body.needsAttentionLane !== undefined ? { needsAttentionLane: body.needsAttentionLane } : {}),
        ...(body.standupTurnMode !== undefined ? { standupTurnMode: body.standupTurnMode } : {}),
        ...(body.standupTurnSeconds !== undefined ? { standupTurnSeconds: body.standupTurnSeconds } : {}),
        // Clamped rather than trusted: a cap of 0 makes every member render as infinitely
        // overloaded, and an absurd one makes the meter useless in the other direction.
        ...(body.defaultMemberWipCap !== undefined
          ? { defaultMemberWipCap: Math.max(1, Math.min(100, Math.floor(body.defaultMemberWipCap))) }
          : {}),
        ...(body.hideDoneItems !== undefined ? { hideDoneItems: body.hideDoneItems } : {}),
        ...(body.requireExecutionApproval !== undefined ? { requireExecutionApproval: body.requireExecutionApproval } : {}),
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
  router.post('/:boardId/swimlanes/ensure-defaults', requireRole(TenantRole.DEVELOPER), async (c) => {
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

  // A lane edit RE-FILES every ticket in it (create shifts nothing, but rename moves
  // each resident's status and delete merges them away), so the write half of board
  // configuration is DEVELOPER — the tier `runtime.execute` uses, and the tier the
  // `board.manageLanes` capability advertises in the editor. Reads stay open.
  router.post('/:boardId/swimlanes', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    if (!(await assertBoard(tenantId, boardId))) return c.json({ error: 'Board not found' }, 404);

    const body = await c.req.json<LaneWriteBody & { name: string }>();
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);

    // The key is DERIVED from the name unless the caller names one. It used to be
    // derived in the lane editor instead, from whatever lane list the browser was
    // holding — a uniqueness check against a stale snapshot, which two people adding
    // a column at once turn into a UNIQUE(board_id, key) 500. Here the check and the
    // insert see the same rows.
    const boardLaneKeys = await db
      .select({ key: swimlanes.key })
      .from(swimlanes)
      .where(and(eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)))
      .then((rows) => rows.map((r) => r.key));
    const key = body.key?.trim()
      ? uniqueLaneKey(body.key, boardLaneKeys)
      : uniqueLaneKey(body.name, boardLaneKeys);

    const now = new Date();
    // APPEND when no position is given, rather than defaulting to 0. `?? 0` stacked every
    // un-positioned lane onto the same ordinal, and lane ORDER is what decides which lane a
    // completing run advances into — so a tie made "the next lane" depend on row order.
    // Measured: board ad030733 carries `ready` and `todo` both at position 1.
    const nextPosition = body.position ?? await db
      .select({ max: sql<number>`coalesce(max(${swimlanes.position}), -1)` })
      .from(swimlanes)
      .where(and(eq(swimlanes.tenantId, tenantId), eq(swimlanes.boardId, boardId)))
      .then((r) => Number(r[0]?.max ?? -1) + 1)
      .catch(() => 0);
    const [row] = await db
      .insert(swimlanes)
      .values({
        tenantId,
        segmentId: c.get('segmentId') ?? null,
        boardId,
        key,
        name: body.name.trim(),
        position: nextPosition,
        isTerminal: body.isTerminal ?? false,
        gate: body.gate ?? 'auto',
        // A lane a person CREATED with an explicit gate carries their choice; one
        // that took the default did not choose anything (DISP-R2).
        gateSource: body.gate !== undefined ? 'operator' : 'seed',
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

  router.patch('/:boardId/swimlanes/:laneId', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const laneId = c.req.param('laneId');

    const body = await c.req.json<LaneWriteBody>();

    // RENAMING THE KEY IS A CASCADE, NOT A COLUMN WRITE. The key IS the status every
    // resident ticket holds, and three other live rows point at a lane by it, so this
    // runs BEFORE the ordinary field update and through the one primitive that carries
    // them all. Rejected in the route (400) rather than at the UNIQUE(board_id, key)
    // constraint (500), and validated against the board's OTHER lanes so a no-op
    // rename — the shape a client that PATCHes every field produces — costs nothing.
    let renamed: Awaited<ReturnType<typeof renameLaneKey>> | null = null;
    if (body.key !== undefined) {
      const laneRows = await db
        .select({ id: swimlanes.id, key: swimlanes.key })
        .from(swimlanes)
        .where(and(eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)));
      const current = laneRows.find((l) => l.id === laneId);
      if (!current) return c.json({ error: 'Swimlane not found' }, 404);

      const decision = validateLaneKeyChange({
        requested: body.key,
        currentKey: current.key,
        siblingKeys: laneRows.filter((l) => l.id !== laneId).map((l) => l.key),
      });
      if (!decision.ok) {
        return c.json({
          error: decision.error === 'duplicate_key'
            ? 'Another column on this board already uses that key'
            : 'A column key needs at least one letter or number',
          code: decision.error,
        }, 400);
      }
      if (decision.changed) {
        renamed = await renameLaneKey(db, {
          tenantId, boardId, laneId, oldKey: current.key, newKey: decision.key,
        });
      }
    }

    await db
      .update(swimlanes)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.isTerminal !== undefined ? { isTerminal: body.isTerminal } : {}),
        ...(body.isParking !== undefined ? { isParking: body.isParking } : {}),
        // The gate AND its provenance move together: an operator editing the gate is
        // the only event that can ever produce 'operator', which is what makes a
        // later default change able to leave deliberate choices alone (DISP-R2).
        ...(body.gate !== undefined ? { gate: body.gate, gateSource: 'operator' } : {}),
        ...(body.executionMode !== undefined ? { executionMode: body.executionMode } : {}),
        ...(body.failurePolicy !== undefined ? { failurePolicy: body.failurePolicy } : {}),
        ...(body.actionType !== undefined ? { actionType: body.actionType || null } : {}),
        ...(body.actionTarget !== undefined ? { actionTarget: body.actionTarget || null } : {}),
        ...(body.successPolicy !== undefined ? { successPolicy: body.successPolicy } : {}),
        ...(body.successThreshold !== undefined ? { successThreshold: body.successThreshold } : {}),
        ...(body.requirementGate !== undefined && ['off', 'soft', 'hard'].includes(body.requirementGate)
          ? { requirementGate: body.requirementGate } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(swimlanes.id, laneId), eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)));

    const [row] = await db
      .select()
      .from(swimlanes)
      .where(and(eq(swimlanes.id, laneId), eq(swimlanes.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Swimlane not found' }, 404);
    // A rename moved other people's data. Report exactly what it touched so the
    // editor can say "12 tickets moved" instead of leaving the operator to guess.
    return c.json(renamed ? { ...row, renamed } : row);
  });

  // DELETE a lane = MERGE it into another. `?into=<laneKey>` names the target; without
  // it the automatic policy applies (the lowest-position non-terminal survivor). Until
  // the parameter existed, folding `Ready` into `To Do` silently sent its tickets
  // wherever the policy pointed, which is a different board than the operator asked for.
  router.delete('/:boardId/swimlanes/:laneId', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const laneId = c.req.param('laneId');
    const reassignTo = c.req.query('into')?.trim() || null;

    // Referential integrity: tasks couple to their lane by `task.status === lane.key`
    // with no FK, so deleting a lane orphans every task sitting in it (it keeps the
    // now-dead status string). Reassign those tasks onto a surviving lane FIRST so
    // none is left holding a status no lane defines. Best-effort + reported, never
    // fatal to the delete.
    const [lane] = await db
      .select({ key: swimlanes.key })
      .from(swimlanes)
      .where(and(eq(swimlanes.id, laneId), eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)));
    let reassigned: { movedTo: string | null; movedCount: number } = { movedTo: null, movedCount: 0 };
    if (lane) {
      reassigned = await reassignOrphanedTasksOnLaneDelete(db, {
        tenantId,
        boardId,
        deletedLaneId: laneId,
        deletedLaneKey: lane.key,
        reassignTo,
      }).catch(() => ({ movedTo: null, movedCount: 0 }));
    }

    await db
      .delete(swimlanes)
      .where(and(eq(swimlanes.id, laneId), eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)));
    return c.json({ ok: true, reassignedTasks: reassigned.movedCount, reassignedTo: reassigned.movedTo });
  });

  // ── Orphaned tickets — the tickets in NO lane ──────────────────────────────
  //
  // `tasks.swimlane_id IS NULL` on a project that HAS a board (migration 1115).
  // The board renders them in an appended fallback column so none is hidden, but a
  // fallback column is not a lane: no gate, no staffed agent and no requirement
  // applies to a ticket whose status no lane defines, so it can never auto-run and
  // never advance. It is invisible work, and until the FK existed nothing outside
  // the board component could even count it.

  router.get('/:boardId/orphaned-tasks', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const [board] = await db
      .select({ projectId: boards.projectId })
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.tenantId, tenantId)));
    if (!board) return c.json({ error: 'Board not found' }, 404);
    const count = await countOrphanedTasks(db, { tenantId, projectId: board.projectId });
    return c.json({ count });
  });

  // Re-home them onto a lane the operator names — the same contract as deleting a
  // lane with `?into=`: where stranded work goes is a decision, not a policy.
  router.post('/:boardId/orphaned-tasks/adopt', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    if (!(await assertBoard(tenantId, boardId))) return c.json({ error: 'Board not found' }, 404);
    const body = await c.req.json<{ into?: string }>().catch(() => ({} as { into?: string }));
    const targetKey = body.into?.trim();
    if (!targetKey) return c.json({ error: 'into (a lane key) is required' }, 400);

    const adopted = await adoptOrphanedTasks(db, { tenantId, boardId, targetKey });
    if (!adopted.movedTo) return c.json({ error: 'That board has no column with that key' }, 400);
    return c.json({ ok: true, movedTo: adopted.movedTo, movedCount: adopted.movedCount });
  });

  // ── Agent assignments (nested under a lane) ────────────────────────────────

  /** The lane's key when it belongs to this board+tenant, else null. */
  async function loadLaneKey(tenantId: number, boardId: string, laneId: string): Promise<string | null> {
    const [lane] = await db
      .select({ key: swimlanes.key })
      .from(swimlanes)
      .where(and(eq(swimlanes.id, laneId), eq(swimlanes.boardId, boardId), eq(swimlanes.tenantId, tenantId)));
    return lane?.key ?? null;
  }

  async function assertLane(tenantId: number, boardId: string, laneId: string): Promise<boolean> {
    return (await loadLaneKey(tenantId, boardId, laneId)) != null;
  }

  router.get('/:boardId/swimlanes/:laneId/agents', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const laneId = c.req.param('laneId');
    if (!(await assertLane(tenantId, boardId, laneId))) return c.json({ error: 'Swimlane not found' }, 404);
    const rows = await db
      .select()
      .from(laneAgentAssignments)
      // Lane staffing lives in the canonical `agent_assignments` since 1085; `forLane` is
      // the ONE place the `scope = 'swimlane'` predicate is written.
      .where(forLane(laneId, eq(laneAgentAssignments.tenantId, tenantId)))
      .orderBy(asc(laneAgentAssignments.position));
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
      role?: string;
      taskTemplate?: string;
      requiredCapabilities?: unknown;
      model?: string;
      position?: number;
    }>();

    /**
     * Resolve the chosen registry agent (runtime/host/model defaults) at assign time so
     * the dispatch pipeline keeps reading plain columns.
     *
     * A lane assignment MUST name an agent. There used to be a second, "legacy" branch
     * here that accepted a free-text `role` alone and wrote `agentKind`/`agentRef` as
     * null — which migration 1085 made impossible: lane staffing now lives in the
     * canonical `agent_assignments`, where both columns are NOT NULL, and 1085 DELETED
     * the pre-existing role-only rows on the same reasoning ("a lane assignment naming
     * no agent could never be dispatched — it was a half-written row"). That branch
     * could therefore only ever produce a constraint violation, and no client sent it:
     * the typed API client has required `agentKind` + `agentRef` since. A `role` is
     * still accepted, as the OVERRIDE it always was on top of a named agent.
     */
    if (!body.agentKind || !body.agentRef) {
      return c.json({ error: 'agentKind and agentRef are required — a lane assignment must name an agent' }, 400);
    }
    let resolved: {
      agentKind: AgentKind;
      agentRef: string;
      name: string | null;
      role: string;
      runtime: string;
      target: string | null;
      model: string | null;
    };
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

    const [row] = await db
      .insert(laneAgentAssignments)
      .values(laneAssignmentValues({
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
      }))
      .returning();

    // ── THE MOMENT THE ANSWER CHANGES ───────────────────────────────────────────
    // The autonomous trigger only fires when a ticket ENTERS a lane. Staffing a lane
    // that already holds tickets therefore did nothing to any of them — they never
    // "entered", so nothing ever asked whether they should run, and the only way to
    // start them was to drag each one out and back in. Staffing IS the event; sweep
    // the residents through the same funnel a drag uses. Off the response path.
    const laneKey = await loadLaneKey(tenantId, boardId, laneId);
    if (laneKey) {
      c.executionCtx.waitUntil(
        backfillLaneResidents(c.env as Env, db, {
          tenantId,
          boardId,
          laneKey,
          submittedBy: (c as { get(k: 'userId'): string | undefined }).get('userId') ?? 'system:lane-staffed',
        }).then(() => undefined).catch(() => undefined),
      );
    }
    return c.json(row, 201);
  });

  /**
   * POST /:boardId/swimlanes/:laneId/run-lane — "Run this lane now".
   *
   * The explicit half of the same fix: an operator who staffed a lane before this
   * existed (or who relaxed a gate, or fixed a capability requirement) can start the
   * tickets already sitting in it without dragging each one out and back. Every
   * per-ticket guard still applies — it routes through the ordinary lane funnel.
   *
   * DEVELOPER+, the same tier as `POST /api/tasks/:id/run-now`: this starts billable
   * runs, and doing so for a whole lane at once is emphatically not a read.
   */
  router.post('/:boardId/swimlanes/:laneId/run-lane', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const laneId = c.req.param('laneId');
    const laneKey = await loadLaneKey(tenantId, boardId, laneId);
    if (!laneKey) return c.json({ error: 'Swimlane not found' }, 404);

    const body = await c.req.json<{ limit?: unknown }>().catch(() => ({ limit: undefined }));
    const limit = typeof body.limit === 'number' && Number.isSafeInteger(body.limit) && body.limit > 0
      ? body.limit
      : undefined;

    const result = await backfillLaneResidents(c.env as Env, db, {
      tenantId,
      boardId,
      laneKey,
      submittedBy: (c as { get(k: 'userId'): string | undefined }).get('userId') ?? 'system:run-lane',
      ...(limit != null ? { limit } : {}),
    });
    return c.json(result);
  });

  router.delete('/:boardId/swimlanes/:laneId/agents/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const laneId = c.req.param('laneId');
    const id = c.req.param('id');
    await db
      .delete(laneAgentAssignments)
      .where(forLane(
        laneId,
        eq(laneAgentAssignments.id, id),
        eq(laneAgentAssignments.tenantId, tenantId),
      ));
    return c.body(null, 204);
  });

  // ── Lane requirements (role / diagnostic / review checks a lane enforces) ────
  // The LIVE per-lane requirements the audit + gating engines read. Previously only
  // materialised by applying a template (re-apply to change) — now directly editable
  // so a running board's requirements evolve without re-applying a template.

  router.get('/:boardId/swimlanes/:laneId/requirements', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const laneId = c.req.param('laneId');
    if (!(await assertLane(tenantId, boardId, laneId))) return c.json({ error: 'Swimlane not found' }, 404);
    const rows = await db
      .select()
      .from(swimlaneRequirements)
      .where(and(eq(swimlaneRequirements.swimlaneId, laneId), eq(swimlaneRequirements.tenantId, tenantId)))
      .orderBy(asc(swimlaneRequirements.position));
    return c.json({ requirements: rows });
  });

  router.post('/:boardId/swimlanes/:laneId/requirements', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const laneId = c.req.param('laneId');
    if (!boardId || !laneId) return c.json({ error: 'Swimlane not found' }, 404);
    if (!(await assertLane(tenantId, boardId, laneId))) return c.json({ error: 'Swimlane not found' }, 404);
    const body = await c.req.json<{ kind: string; ref: string; responsibility?: string; isRequired?: boolean; description?: string; position?: number }>();
    const kind = ['role', 'diagnostic', 'review'].includes(body.kind) ? body.kind : null;
    if (!kind || !body.ref?.trim()) return c.json({ error: 'kind (role|diagnostic|review) and ref are required' }, 400);
    const [row] = await db
      .insert(swimlaneRequirements)
      .values({
        id: crypto.randomUUID(),
        tenantId,
        swimlaneId: laneId,
        kind,
        ref: body.ref.trim().slice(0, 120),
        responsibility: body.responsibility && ['owner', 'reviewer', 'contributor'].includes(body.responsibility) ? body.responsibility : null,
        isRequired: body.isRequired ?? true,
        description: body.description?.slice(0, 500) ?? null,
        position: body.position ?? 0,
      })
      .returning();
    return c.json(row, 201);
  });

  router.patch('/:boardId/swimlanes/:laneId/requirements/:reqId', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    const tenantId = c.get('tenantId') as number;
    const boardId = c.req.param('boardId');
    const laneId = c.req.param('laneId');
    const reqId = c.req.param('reqId');
    if (!boardId || !laneId || !reqId) return c.json({ error: 'Requirement not found' }, 404);
    if (!(await assertLane(tenantId, boardId, laneId))) return c.json({ error: 'Swimlane not found' }, 404);
    const body = await c.req.json<{ ref?: string; responsibility?: string; isRequired?: boolean; description?: string; position?: number }>();
    await db
      .update(swimlaneRequirements)
      .set({
        ...(body.ref !== undefined ? { ref: body.ref.trim().slice(0, 120) } : {}),
        ...(body.responsibility !== undefined ? { responsibility: ['owner', 'reviewer', 'contributor'].includes(body.responsibility) ? body.responsibility : null } : {}),
        ...(body.isRequired !== undefined ? { isRequired: body.isRequired } : {}),
        ...(body.description !== undefined ? { description: body.description?.slice(0, 500) || null } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
      })
      .where(and(eq(swimlaneRequirements.id, reqId), eq(swimlaneRequirements.swimlaneId, laneId), eq(swimlaneRequirements.tenantId, tenantId)));
    const [row] = await db.select().from(swimlaneRequirements).where(and(eq(swimlaneRequirements.id, reqId), eq(swimlaneRequirements.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Requirement not found' }, 404);
    return c.json(row);
  });

  router.delete('/:boardId/swimlanes/:laneId/requirements/:reqId', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    const tenantId = c.get('tenantId') as number;
    const laneId = c.req.param('laneId');
    const reqId = c.req.param('reqId');
    if (!laneId || !reqId) return c.body(null, 204);
    await db
      .delete(swimlaneRequirements)
      .where(and(eq(swimlaneRequirements.id, reqId), eq(swimlaneRequirements.swimlaneId, laneId), eq(swimlaneRequirements.tenantId, tenantId)));
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
        name: laneAgentAssignments.name,
        stageSeq: agentDispatches.stageSeq,
        position: agentDispatches.position,
        updatedAt: agentDispatches.updatedAt,
      })
      .from(agentDispatches)
      .innerJoin(ticketRuns, eq(agentDispatches.ticketRunId, ticketRuns.id))
      .leftJoin(laneAgentAssignments, eq(agentDispatches.assignmentId, laneAgentAssignments.id))
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
