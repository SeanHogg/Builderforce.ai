import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SwimlaneCoordinator, TicketCapacityError, type StageDispatcher } from './SwimlaneCoordinator';
import { MAX_AUTO_RETRIES } from './transitions';
import type {
  AssignmentLite,
  BoardLite,
  CoordinatorStore,
  DispatchLite,
  LaneLite,
  NewDispatch,
  TicketRunLite,
  TransitionRecord,
} from './coordinatorStore';

/**
 * In-memory CoordinatorStore — exercises the FULL launch → dispatch → result →
 * autonomous-advance loop without a DB. Ids are deterministic counters.
 */
class InMemoryStore implements CoordinatorStore {
  boards = new Map<string, BoardLite>();
  lanes: LaneLite[] = [];
  assignments: AssignmentLite[] = [];
  runs = new Map<string, TicketRunLite>();
  dispatches = new Map<string, DispatchLite>();
  transitions: TransitionRecord[] = [];
  private seq = 0;
  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  async getBoard(boardId: string, tenantId: number) {
    const b = this.boards.get(boardId);
    return b && b.tenantId === tenantId ? b : null;
  }
  async countActiveTickets(boardId: string, tenantId: number, active: string[]) {
    return [...this.runs.values()].filter(
      (r) => r.boardId === boardId && r.tenantId === tenantId && active.includes(r.lifecycle),
    ).length;
  }
  async listLanes(boardId: string, tenantId: number) {
    return this.lanes
      .filter((l) => l.boardId === boardId)
      .filter(() => this.boards.get(boardId)?.tenantId === tenantId)
      .sort((a, b) => a.position - b.position);
  }
  async getLane(swimlaneId: string, _tenantId: number) {
    return this.lanes.find((l) => l.id === swimlaneId) ?? null;
  }
  async listAssignments(swimlaneId: string, _tenantId: number) {
    return this.assignments
      .filter((a) => (a as AssignmentLite & { swimlaneId: string }).swimlaneId === swimlaneId)
      .sort((a, b) => a.position - b.position);
  }
  async createTicketRun(data: {
    tenantId: number; boardId: string; taskId: number;
    currentSwimlaneId: string | null; lifecycle: string; stageHistory: string;
  }) {
    const run: TicketRunLite = {
      id: this.id('run'),
      tenantId: data.tenantId,
      boardId: data.boardId,
      taskId: data.taskId,
      currentSwimlaneId: data.currentSwimlaneId,
      lifecycle: data.lifecycle,
      currentWorkflowId: null,
      stageHistory: data.stageHistory,
      error: null,
    };
    this.runs.set(run.id, run);
    return run;
  }
  async getTicketRun(id: string) {
    return this.runs.get(id) ?? null;
  }
  async updateTicketRun(
    id: string, tenantId: number,
    patch: { lifecycle: string; currentSwimlaneId: string | null; stageHistory: string; error: string | null },
  ) {
    const run = this.runs.get(id);
    if (!run || run.tenantId !== tenantId) return null;
    const updated = { ...run, ...patch };
    this.runs.set(id, updated);
    return updated;
  }
  async recordTransition(t: TransitionRecord) {
    this.transitions.push(t);
  }
  async insertDispatch(data: NewDispatch) {
    const d: DispatchLite = {
      id: this.id('disp'),
      tenantId: data.tenantId,
      ticketRunId: data.ticketRunId,
      swimlaneId: data.swimlaneId,
      assignmentId: data.assignmentId,
      taskId: data.taskId,
      agentId: data.agentId,
      stageSeq: data.stageSeq,
      role: data.role,
      runtime: data.runtime,
      target: data.target,
      model: data.model,
      input: data.input,
      status: data.status,
      output: null,
      error: null,
      dependsOn: data.dependsOn,
      externalRef: null,
      position: data.position,
    };
    this.dispatches.set(d.id, d);
    return d.id;
  }
  async updateDispatch(
    id: string,
    patch: Partial<{ status: string; output: string | null; error: string | null; externalRef: string | null; dependsOn: string; completedAt: boolean }>,
  ) {
    const d = this.dispatches.get(id);
    if (!d) return;
    const { completedAt, ...rest } = patch;
    void completedAt;
    this.dispatches.set(id, { ...d, ...rest });
  }
  async getDispatch(id: string, tenantId: number) {
    const d = this.dispatches.get(id);
    return d && d.tenantId === tenantId ? d : null;
  }
  async listStageDispatches(ticketRunId: string, stageSeq: number, tenantId: number) {
    return [...this.dispatches.values()].filter(
      (d) => d.ticketRunId === ticketRunId && d.stageSeq === stageSeq && d.tenantId === tenantId,
    );
  }
  async maxStageSeq(ticketRunId: string) {
    const seqs = [...this.dispatches.values()].filter((d) => d.ticketRunId === ticketRunId).map((d) => d.stageSeq);
    return seqs.length ? Math.max(...seqs) : 0;
  }

  // test helpers
  seedBoard(b: Partial<BoardLite> & { id: string; tenantId: number }): BoardLite {
    const board: BoardLite = {
      autonomous: false, maxConcurrentTickets: 5, needsAttentionLane: 'needs-attention', ...b,
    };
    this.boards.set(board.id, board);
    return board;
  }
  seedLane(l: Partial<LaneLite> & { id: string; boardId: string; position: number }): LaneLite {
    const lane: LaneLite = {
      key: l.id, isTerminal: false, gate: 'auto', executionMode: 'sequential',
      actionType: null, actionTarget: null, successPolicy: 'all', successThreshold: null,
      failurePolicy: 'needs_attention', ...l,
    };
    this.lanes.push(lane);
    return lane;
  }
  seedAssignment(swimlaneId: string, a: Partial<AssignmentLite> & { id: string; role: string; runtime: string }) {
    const assignment = {
      target: null, taskTemplate: null, model: null, position: 0, ...a, swimlaneId,
    } as AssignmentLite & { swimlaneId: string };
    this.assignments.push(assignment);
  }
  pending(ticketRunId: string): DispatchLite[] {
    return [...this.dispatches.values()].filter((d) => d.ticketRunId === ticketRunId && d.status === 'pending');
  }
}

const TENANT = 1;
const acceptingDispatcher: StageDispatcher = {
  dispatch: vi.fn(async (d: DispatchLite) => ({ accepted: true, externalRef: d.id })),
};

describe('SwimlaneCoordinator — execution loop', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
    vi.clearAllMocks();
  });

  it('autonomous board: a ticket runs lane 0, advances on success, and reaches done at the terminal lane', async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT, autonomous: true });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0 });
    store.seedLane({ id: 'l1', boardId: 'b1', position: 1, isTerminal: true });
    store.seedAssignment('l0', { id: 'a0', role: 'implementer', runtime: 'browser' });
    store.seedAssignment('l1', { id: 'a1', role: 'reviewer', runtime: 'browser' });

    const coord = new SwimlaneCoordinator(store);
    const run = await coord.startTicket('b1', 42, TENANT);

    expect(run.lifecycle).toBe('stage_running');
    expect(run.currentSwimlaneId).toBe('l0');
    const lane0Pending = store.pending(run.id);
    expect(lane0Pending).toHaveLength(1);
    expect(lane0Pending[0]!.runtime).toBe('browser');

    // Browser worker finishes lane 0 → autonomous advance to lane 1.
    await coord.reportDispatchResult(lane0Pending[0]!.id, TENANT, { status: 'completed' });
    let cur = (await store.getTicketRun(run.id))!;
    expect(cur.lifecycle).toBe('stage_running');
    expect(cur.currentSwimlaneId).toBe('l1');
    const lane1Pending = store.pending(run.id);
    expect(lane1Pending).toHaveLength(1);

    // Finish the terminal lane → done.
    await coord.reportDispatchResult(lane1Pending[0]!.id, TENANT, { status: 'completed' });
    cur = (await store.getTicketRun(run.id))!;
    expect(cur.lifecycle).toBe('done');
  });

  it('NO silent advance: a failed stage routes to needs_attention and stays on the same lane', async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT, autonomous: true });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0 });
    store.seedLane({ id: 'l1', boardId: 'b1', position: 1, isTerminal: true });
    store.seedAssignment('l0', { id: 'a0', role: 'implementer', runtime: 'browser' });

    const coord = new SwimlaneCoordinator(store);
    const run = await coord.startTicket('b1', 1, TENANT);
    const d = store.pending(run.id)[0]!;

    await coord.reportDispatchResult(d.id, TENANT, { status: 'failed', error: 'boom' });
    const cur = (await store.getTicketRun(run.id))!;
    expect(cur.lifecycle).toBe('needs_attention');
    expect(cur.currentSwimlaneId).toBe('l0'); // did NOT advance to l1
    expect(cur.error).toBe('stage workflow failed');
  });

  it("failure_policy='skip': a failed stage advances past the lane instead of parking [1316]", async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT, autonomous: true });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, failurePolicy: 'skip' });
    store.seedLane({ id: 'l1', boardId: 'b1', position: 1, isTerminal: true });
    store.seedAssignment('l0', { id: 'a0', role: 'implementer', runtime: 'browser' });

    const coord = new SwimlaneCoordinator(store);
    const run = await coord.startTicket('b1', 1, TENANT);
    const d = store.pending(run.id)[0]!;

    await coord.reportDispatchResult(d.id, TENANT, { status: 'failed', error: 'boom' });
    const cur = (await store.getTicketRun(run.id))!;
    // Skipped past the failed l0 and advanced to the next lane (l1, terminal →
    // the run completes). The key point: it did NOT park at needs_attention on l0.
    expect(cur.lifecycle).not.toBe('needs_attention');
    expect(cur.lifecycle).toBe('done');
    expect(cur.currentSwimlaneId).toBe('l1');
  });

  it("failure_policy='retry': re-runs the lane up to N times, then parks [1316]", async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT, autonomous: true });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, failurePolicy: 'retry' });
    store.seedLane({ id: 'l1', boardId: 'b1', position: 1, isTerminal: true });
    store.seedAssignment('l0', { id: 'a0', role: 'implementer', runtime: 'browser' });

    const coord = new SwimlaneCoordinator(store);
    const run = await coord.startTicket('b1', 1, TENANT);

    // The first MAX_AUTO_RETRIES failures each re-run the same lane (stage_running).
    for (let i = 0; i < MAX_AUTO_RETRIES; i++) {
      const d = store.pending(run.id)[0]!;
      await coord.reportDispatchResult(d.id, TENANT, { status: 'failed', error: 'boom' });
      const cur = (await store.getTicketRun(run.id))!;
      expect(cur.lifecycle).toBe('stage_running'); // auto-retried, same lane
      expect(cur.currentSwimlaneId).toBe('l0');
    }
    // One more failure hits the cap → parks for a human.
    const dFinal = store.pending(run.id)[0]!;
    await coord.reportDispatchResult(dFinal.id, TENANT, { status: 'failed', error: 'boom' });
    expect((await store.getTicketRun(run.id))!.lifecycle).toBe('needs_attention');
  });

  it('sequential lane: only the first agent dispatches; the second unblocks when the first completes', async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT, autonomous: true });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, isTerminal: true, executionMode: 'sequential' });
    store.seedAssignment('l0', { id: 'a0', role: 'first', runtime: 'browser', position: 0 });
    store.seedAssignment('l0', { id: 'a1', role: 'second', runtime: 'browser', position: 1 });

    const coord = new SwimlaneCoordinator(store);
    const run = await coord.startTicket('b1', 7, TENANT);

    // Sequential → exactly one pending, one blocked.
    const all = await store.listStageDispatches(run.id, 1, TENANT);
    expect(all.filter((d) => d.status === 'pending')).toHaveLength(1);
    expect(all.filter((d) => d.status === 'blocked')).toHaveLength(1);
    const first = all.find((d) => d.status === 'pending')!;

    await coord.reportDispatchResult(first.id, TENANT, { status: 'completed' });
    const afterFirst = await store.listStageDispatches(run.id, 1, TENANT);
    expect(afterFirst.filter((d) => d.status === 'pending')).toHaveLength(1); // the second is now ready
    const second = afterFirst.find((d) => d.status === 'pending')!;
    expect(second.id).not.toBe(first.id);

    await coord.reportDispatchResult(second.id, TENANT, { status: 'completed' });
    expect((await store.getTicketRun(run.id))!.lifecycle).toBe('done');
  });

  it('parallel lane: both agents dispatch at once; stage completes only when both finish', async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT, autonomous: true });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, isTerminal: true, executionMode: 'parallel' });
    store.seedAssignment('l0', { id: 'a0', role: 'x', runtime: 'browser', position: 0 });
    store.seedAssignment('l0', { id: 'a1', role: 'y', runtime: 'browser', position: 1 });

    const coord = new SwimlaneCoordinator(store);
    const run = await coord.startTicket('b1', 9, TENANT);
    const pend = store.pending(run.id);
    expect(pend).toHaveLength(2);

    await coord.reportDispatchResult(pend[0]!.id, TENANT, { status: 'completed' });
    expect((await store.getTicketRun(run.id))!.lifecycle).toBe('stage_running'); // still one running
    await coord.reportDispatchResult(pend[1]!.id, TENANT, { status: 'completed' });
    expect((await store.getTicketRun(run.id))!.lifecycle).toBe('done');
  });

  it('human gate: a successful stage waits at the gate; approveGate advances it', async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, gate: 'human' });
    store.seedLane({ id: 'l1', boardId: 'b1', position: 1, isTerminal: true });
    store.seedAssignment('l0', { id: 'a0', role: 'impl', runtime: 'browser' });
    store.seedAssignment('l1', { id: 'a1', role: 'rev', runtime: 'browser' });

    const coord = new SwimlaneCoordinator(store);
    const run = await coord.startTicket('b1', 3, TENANT);
    await coord.reportDispatchResult(store.pending(run.id)[0]!.id, TENANT, { status: 'completed' });

    let cur = (await store.getTicketRun(run.id))!;
    expect(cur.lifecycle).toBe('awaiting_gate');
    expect(cur.currentSwimlaneId).toBe('l0');

    await coord.approveGate(run.id);
    cur = (await store.getTicketRun(run.id))!;
    expect(cur.lifecycle).toBe('stage_running');
    expect(cur.currentSwimlaneId).toBe('l1');
    expect(store.pending(run.id)).toHaveLength(1);
  });

  it('agentHost runtime: a cloud dispatch is pushed via the injected dispatcher and marked running', async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT, autonomous: true });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, isTerminal: true });
    store.seedAssignment('l0', { id: 'a0', role: 'impl', runtime: 'cloud' });

    const coord = new SwimlaneCoordinator(store, acceptingDispatcher);
    const run = await coord.startTicket('b1', 5, TENANT);

    expect(acceptingDispatcher.dispatch).toHaveBeenCalledTimes(1);
    const all = await store.listStageDispatches(run.id, 1, TENANT);
    expect(all[0]!.status).toBe('running'); // pushed, awaiting agentHost callback
    expect((await store.getTicketRun(run.id))!.lifecycle).toBe('stage_running');

    await coord.reportDispatchResult(all[0]!.id, TENANT, { status: 'completed' });
    expect((await store.getTicketRun(run.id))!.lifecycle).toBe('done');
  });

  it('agentHost runtime with no dispatcher: the dispatch fails and the ticket goes to needs_attention', async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT, autonomous: true });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, isTerminal: true });
    store.seedAssignment('l0', { id: 'a0', role: 'impl', runtime: 'cloud' });

    const coord = new SwimlaneCoordinator(store); // no dispatcher
    const run = await coord.startTicket('b1', 6, TENANT);
    expect((await store.getTicketRun(run.id))!.lifecycle).toBe('needs_attention');
  });

  it('enforces maxConcurrentTickets', async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT, autonomous: true, maxConcurrentTickets: 1 });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, isTerminal: true });
    store.seedAssignment('l0', { id: 'a0', role: 'impl', runtime: 'browser' });

    const coord = new SwimlaneCoordinator(store);
    await coord.startTicket('b1', 1, TENANT);
    await expect(coord.startTicket('b1', 2, TENANT)).rejects.toBeInstanceOf(TicketCapacityError);
  });

  it("move_ticket action: a successful stage moves the ticket to the lane named by action_target, not the next lane", async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, actionType: 'move_ticket', actionTarget: 'done-lane' });
    store.seedLane({ id: 'l1', boardId: 'b1', position: 1 }); // the "next" lane — should be SKIPPED
    store.seedLane({ id: 'l2', boardId: 'b1', key: 'done-lane', position: 2, isTerminal: true });
    store.seedAssignment('l0', { id: 'a0', role: 'impl', runtime: 'browser' });

    const coord = new SwimlaneCoordinator(store);
    const run = await coord.startTicket('b1', 1, TENANT);
    await coord.reportDispatchResult(store.pending(run.id)[0]!.id, TENANT, { status: 'completed' });

    const cur = (await store.getTicketRun(run.id))!;
    expect(cur.currentSwimlaneId).toBe('l2'); // jumped past l1 to the named lane
  });

  it('run_workflow action: a successful stage fires the workflow runner, then advances', async () => {
    const runner = { run: vi.fn(async () => {}) };
    store.seedBoard({ id: 'b1', tenantId: TENANT });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, isTerminal: true, actionType: 'run_workflow', actionTarget: 'wf-123' });
    store.seedAssignment('l0', { id: 'a0', role: 'impl', runtime: 'browser' });

    const coord = new SwimlaneCoordinator(store, undefined, runner);
    const run = await coord.startTicket('b1', 8, TENANT);
    await coord.reportDispatchResult(store.pending(run.id)[0]!.id, TENANT, { status: 'completed' });

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith('wf-123', expect.objectContaining({ tenantId: TENANT, taskId: 8 }));
    expect((await store.getTicketRun(run.id))!.lifecycle).toBe('done');
  });

  it("success policy 'any': a parallel stage advances when one agent succeeds even though another fails", async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, isTerminal: true, executionMode: 'parallel', successPolicy: 'any' });
    store.seedAssignment('l0', { id: 'a0', role: 'x', runtime: 'browser', position: 0 });
    store.seedAssignment('l0', { id: 'a1', role: 'y', runtime: 'browser', position: 1 });

    const coord = new SwimlaneCoordinator(store);
    const run = await coord.startTicket('b1', 9, TENANT);
    const pend = store.pending(run.id);
    expect(pend).toHaveLength(2);

    await coord.reportDispatchResult(pend[0]!.id, TENANT, { status: 'completed' });
    await coord.reportDispatchResult(pend[1]!.id, TENANT, { status: 'failed', error: 'boom' });
    // one of two succeeded → quorum met for 'any'
    expect((await store.getTicketRun(run.id))!.lifecycle).toBe('done');
  });

  it("success policy 'all': one failure in a parallel stage routes to needs_attention", async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, isTerminal: true, executionMode: 'parallel', successPolicy: 'all' });
    store.seedAssignment('l0', { id: 'a0', role: 'x', runtime: 'browser', position: 0 });
    store.seedAssignment('l0', { id: 'a1', role: 'y', runtime: 'browser', position: 1 });

    const coord = new SwimlaneCoordinator(store);
    const run = await coord.startTicket('b1', 10, TENANT);
    const pend = store.pending(run.id);

    await coord.reportDispatchResult(pend[0]!.id, TENANT, { status: 'completed' });
    await coord.reportDispatchResult(pend[1]!.id, TENANT, { status: 'failed', error: 'boom' });
    expect((await store.getTicketRun(run.id))!.lifecycle).toBe('needs_attention');
  });

  it('sequential stage settles (not stuck) when the first agent fails: the blocked second is cancelled', async () => {
    store.seedBoard({ id: 'b1', tenantId: TENANT });
    store.seedLane({ id: 'l0', boardId: 'b1', position: 0, isTerminal: true, executionMode: 'sequential' });
    store.seedAssignment('l0', { id: 'a0', role: 'first', runtime: 'browser', position: 0 });
    store.seedAssignment('l0', { id: 'a1', role: 'second', runtime: 'browser', position: 1 });

    const coord = new SwimlaneCoordinator(store);
    const run = await coord.startTicket('b1', 11, TENANT);
    const first = store.pending(run.id)[0]!;

    await coord.reportDispatchResult(first.id, TENANT, { status: 'failed', error: 'boom' });
    expect((await store.getTicketRun(run.id))!.lifecycle).toBe('needs_attention');
    const all = await store.listStageDispatches(run.id, 1, TENANT);
    expect(all.find((d) => d.id !== first.id)!.status).toBe('cancelled');
  });
});
