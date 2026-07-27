import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authorizeManagedTaskExecution } from './managedExecutionGuard';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import { loadStageProducerSlots, resolveManagedLaneAuthority, slotAuthorizesRole } from './managedLaneRoles';
import { isAgentRefRoleCapable } from './roleCapability';
import { buildRoleRunPayload } from './requestRoleRun';
import type { Db } from '../../infrastructure/database/connection';

/**
 * The guard had NO tests at all, which is how the platform's largest measured autonomy
 * defect shipped: it refused every dispatch the lane trigger could build, and nothing
 * anywhere asserted what the trigger actually builds.
 *
 * The last describe block is the one that matters — a CONTRACT test across the seam,
 * driven off one fixture, rather than two hand-written fixtures agreeing by luck.
 */

vi.mock('../swimlane/canonicalBoard', () => ({ findCanonicalBoard: vi.fn() }));
// `slotAuthorizesRole` is deliberately REAL: it is the pure rule under test in the
// stage-scope block below, and mocking it would assert only that the guard calls a stub.
vi.mock('./managedLaneRoles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./managedLaneRoles')>()),
  resolveManagedLaneAuthority: vi.fn(),
  loadStageProducerSlots: vi.fn(),
}));
vi.mock('./roleCapability', () => ({ isAgentRefRoleCapable: vi.fn() }));

const mockBoard = vi.mocked(findCanonicalBoard);
const mockAuthority = vi.mocked(resolveManagedLaneAuthority);
const mockSlots = vi.mocked(loadStageProducerSlots);
const mockCapable = vi.mocked(isAgentRefRoleCapable);

/** Minimal drizzle stand-in: each awaited chain shifts the next queued result. */
function stubDb(results: unknown[][]): Db {
  const queue = [...results];
  const builder = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'innerJoin', 'leftJoin', 'orderBy']) self[m] = () => self;
    self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(queue.shift() ?? []).then(resolve);
    return self;
  };
  return { select: () => builder() } as unknown as Db;
}

/** Query order inside the guard: task row → lane row. */
const rows = (status = 'todo') => [
  [{ projectId: 11, status, taskType: 'task', actionType: null }],
  [{ id: 'lane-todo' }],
];

const payloadWithRole = (roleKey: string, agentRef: string) =>
  JSON.stringify({ cloudAgentRef: agentRef, actAsRole: roleKey, laneKey: 'todo' });

beforeEach(() => {
  vi.mocked(mockBoard).mockResolvedValue({ id: 'board-1', lifecycleManaged: true } as never);
  mockAuthority.mockResolvedValue({ roleKeys: ['developer'], approvers: [], tier: 'requirements' });
  mockSlots.mockResolvedValue([]);
  mockCapable.mockResolvedValue(true);
});

const slot = (roleKey: string, state = 'assigned') => ({
  roleKey, responsibility: 'reviewer', state, assigneeKind: 'agent', assigneeRef: 'ada',
});

describe('authorizeManagedTaskExecution', () => {
  it('passes through an UNMANAGED board untouched — the guard applies to managed boards only', async () => {
    mockBoard.mockResolvedValue({ id: 'board-1', lifecycleManaged: false } as never);
    const d = await authorizeManagedTaskExecution(stubDb(rows()), 1, 1032, undefined);
    expect(d).toEqual({ allowed: true, managed: false });
  });

  // THE REGRESSION PIN. This exact refusal, on this exact ticket, is what the lane
  // trigger produced every sweep for weeks — and it is still correct behaviour for the
  // GUARD. What changed is that the trigger no longer sends a role-less payload.
  it('refuses a role-less payload on a managed board (the task-1032 refusal)', async () => {
    const d = await authorizeManagedTaskExecution(stubDb(rows()), 1, 1032, JSON.stringify({ cloudAgentRef: 'agent-1', laneKey: 'todo' }));
    expect(d.allowed).toBe(false);
    expect(d.managed).toBe(true);
    expect(d.reason).toContain('lifecycle-managed');
  });

  it('refuses a role the stage does not authorise', async () => {
    mockAuthority.mockResolvedValue({ roleKeys: ['architect'], approvers: [], tier: 'requirements' });
    const d = await authorizeManagedTaskExecution(stubDb(rows()), 1, 1032, payloadWithRole('developer', 'bob-dev'));
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("Role 'developer' is not required");
  });

  it('refuses an authorised role the agent cannot act as', async () => {
    mockCapable.mockResolvedValue(false);
    const d = await authorizeManagedTaskExecution(stubDb(rows()), 1, 1032, payloadWithRole('developer', 'kevin-pm'));
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('not capable');
  });

  it('allows an authorised role dispatched to a capable agent', async () => {
    const d = await authorizeManagedTaskExecution(stubDb(rows()), 1, 1032, payloadWithRole('developer', 'bob-dev'));
    expect(d).toEqual({ allowed: true, managed: true });
  });

  it('refuses when the ticket sits on a status with no coordinated stage', async () => {
    const d = await authorizeManagedTaskExecution(
      stubDb([[{ projectId: 11, status: 'nowhere', taskType: 'task', actionType: null }], []]),
      1, 1032, payloadWithRole('developer', 'bob-dev'),
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('No coordinated stage');
  });
});

/**
 * WHICH STAGE IS BEING AUTHORIZED.
 *
 * A role run serves ONE accountability slot, and an outstanding slot routinely belongs to
 * an earlier stage than the lane the ticket now sits in — that is exactly what "held in
 * review, waiting on 10 of 10 sign-offs" means. The guard measured every such request
 * against `tasks.status`, so `driveOutstandingSignoffs` was refused on every managed
 * ticket: measured on project 11, the gate held 24 tickets and asked ZERO of the 227
 * agent-owed slots, every pass, indefinitely.
 */
describe('the stage a role run is authorized against', () => {
  /** A ticket in `in_review` whose payload asks for the `in_progress` slot. */
  const inReviewAskingEarlierStage = () => [
    [{ projectId: 11, status: 'in_review', taskType: 'task', actionType: null }],
    [{ id: 'lane-in-progress' }],
  ];
  const signoffPayload = JSON.stringify({ cloudAgentRef: 'ada', reviewRole: 'developer', laneKey: 'in_progress' });

  it('resolves the lane from the payload, NOT from the ticket status', async () => {
    const db = stubDb(inReviewAskingEarlierStage());
    await authorizeManagedTaskExecution(db, 1, 302, signoffPayload);
    // The manifest read must be scoped to the slot's stage; scoping it to `in_review`
    // would look up a different lane's slots and find nothing.
    expect(mockSlots).toHaveBeenCalledWith(db, { tenantId: 1, taskId: 302, stageKey: 'in_progress' });
  });

  it('allows an outstanding manifest slot whose role the CURRENT lane template does not name', async () => {
    // The `in_progress` template authorises nobody for this ticket…
    mockAuthority.mockResolvedValue({ roleKeys: [], approvers: [], tier: 'none' });
    // …but the coordinator opened a required Developer slot there, which is the authority.
    mockSlots.mockResolvedValue([slot('developer')]);
    const d = await authorizeManagedTaskExecution(stubDb(inReviewAskingEarlierStage()), 1, 302, signoffPayload);
    expect(d).toEqual({ allowed: true, managed: true });
  });

  it('does NOT treat a satisfied slot as authorization — a waived role is not a licence to run', async () => {
    mockAuthority.mockResolvedValue({ roleKeys: [], approvers: [], tier: 'none' });
    mockSlots.mockResolvedValue([slot('developer', 'waived')]);
    const d = await authorizeManagedTaskExecution(stubDb(inReviewAskingEarlierStage()), 1, 302, signoffPayload);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("stage 'in_progress'");
  });

  it('still refuses a role with neither template nor manifest backing', async () => {
    mockAuthority.mockResolvedValue({ roleKeys: [], approvers: [], tier: 'none' });
    mockSlots.mockResolvedValue([slot('architect')]);
    const d = await authorizeManagedTaskExecution(stubDb(inReviewAskingEarlierStage()), 1, 302, signoffPayload);
    expect(d.allowed).toBe(false);
  });

  it('falls back to the ticket status when the payload names no lane', async () => {
    const db = stubDb(rows('todo'));
    await authorizeManagedTaskExecution(db, 1, 1032, JSON.stringify({ cloudAgentRef: 'bob-dev', actAsRole: 'developer' }));
    expect(mockSlots).toHaveBeenCalledWith(db, { tenantId: 1, taskId: 1032, stageKey: 'todo' });
  });

  // `slotAuthorizesRole` is unmocked above, so this pins the real predicate the guard uses.
  it('slotAuthorizesRole counts only OPEN slots', () => {
    expect(slotAuthorizesRole([slot('developer', 'assigned')], 'developer')).toBe(true);
    expect(slotAuthorizesRole([slot('developer', 'in_progress')], 'developer')).toBe(true);
    expect(slotAuthorizesRole([slot('developer', 'completed')], 'developer')).toBe(false);
    expect(slotAuthorizesRole([slot('developer', 'unstaffed')], 'developer')).toBe(false);
    expect(slotAuthorizesRole([slot('developer')], 'architect')).toBe(false);
  });
});

/**
 * THE CONTRACT. The guard decides what may run; the lane trigger builds what does run.
 * They derived that independently, and the asymmetry WAS the bug — so the property is
 * asserted directly: anything the dispatcher-side payload builder produces from a
 * resolved managed role must be accepted by the guard reading the SAME authority.
 *
 * This is the cheapest test that would have caught the original defect, and it is only
 * writable because both sides now read one resolver.
 */
describe('the evaluator ↔ guard contract', () => {
  it('accepts the payload the trigger builds for a resolved managed producer', async () => {
    // What `resolveManagedProducer` hands the trigger, and what the trigger sends.
    const producer = { roleKey: 'developer', agentRef: 'bob-dev' };
    const payload = buildRoleRunPayload({
      tenantId: 1, projectId: 11, taskId: 1032,
      roleKey: producer.roleKey, roleName: 'Developer', agentRef: producer.agentRef,
      laneKey: 'todo', kind: 'producer', submittedBy: 'system:lane-auto',
    });

    const d = await authorizeManagedTaskExecution(stubDb(rows()), 1, 1032, payload);
    expect(d).toEqual({ allowed: true, managed: true });
  });

  it('and refuses the BARE payload the trigger used to build — the two verdicts must not agree by accident', async () => {
    const bare = JSON.stringify({ cloudAgentRef: 'bob-dev', laneKey: 'todo' });
    const d = await authorizeManagedTaskExecution(stubDb(rows()), 1, 1032, bare);
    expect(d.allowed).toBe(false);
  });
});
