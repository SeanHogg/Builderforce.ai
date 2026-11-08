import { beforeEach, describe, expect, it, vi } from 'vitest';

const listParticipants = vi.fn();
vi.mock('../kanban/ticketParticipants', () => ({
  TicketParticipantsService: class { listParticipants = (...a: unknown[]) => listParticipants(...a); },
}));
vi.mock('../manager/managerActionJournal', async () => ({
  ...(await vi.importActual<typeof import('../manager/managerActionJournal')>('../manager/managerActionJournal')),
  recordManagerAction: vi.fn(),
}));
vi.mock('../manager/reviewGateAuthority', () => ({
  loadReviewLaneGates: vi.fn(async () => new Map()),
  closeTicketAutomatically: vi.fn(),
}));

import { resolveRequiredSignoffGates, resolveRequiredSignoffGate, SIGNOFF_NOT_REQUIRED } from '../kanban/signoffGate';
import { conductReviewTicket, loadConductCohort, type ReviewTicket } from './prConductTicket';

/** db whose every select chain resolves to []. */
function emptyDb() {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'selectDistinct', 'from', 'where', 'orderBy', 'groupBy']) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
  return chain as never;
}

const ticket = (id: number): ReviewTicket => ({
  id, title: `t${id}`, status: 'in_review', gitBranch: `b${id}`, githubPrUrl: null,
  assignedAgentRef: 'a', assignedAgentHostId: null, taskType: 'feature', actionType: null,
});
const policy = (requireSignoffToComplete: boolean) => ({ requireSignoffToComplete, prMergePolicy: 'immediate', managerMayCloseReviewedTickets: false }) as never;
const runtime = { listActiveByTasks: vi.fn(async () => []) } as never;

beforeEach(() => { listParticipants.mockReset(); listParticipants.mockResolvedValue([]); });

describe('resolveRequiredSignoffGates — one batch per project', () => {
  it('sign-off OFF: the whole cohort is answered with zero manifest reads', async () => {
    const out = await resolveRequiredSignoffGates({} as never, emptyDb(), { tenantId: 1, taskIds: [1, 2, 3], requireSignoff: false });
    expect(listParticipants).not.toHaveBeenCalled();
    expect([...out.values()].every((g) => g === SIGNOFF_NOT_REQUIRED)).toBe(true);
    expect(out.size).toBe(3);
  });

  it('sign-off ON: each ticket\'s manifest is read exactly once', async () => {
    const out = await resolveRequiredSignoffGates({} as never, emptyDb(), { tenantId: 1, taskIds: [1, 2, 3], requireSignoff: true });
    expect(listParticipants).toHaveBeenCalledTimes(3);
    expect([...out.keys()].sort()).toEqual([1, 2, 3]);
  });
});

describe('the conduct sweep resolves sign-off once per project, not per ticket', () => {
  it('loadConductCohort carries every ticket\'s gate; conductReviewTicket does not re-resolve', async () => {
    const tickets = [ticket(1), ticket(2), ticket(3)];
    const db = emptyDb();
    const cohort = await loadConductCohort({} as never, db, runtime, { tenantId: 1, projectId: 9, policy: policy(true), tickets });
    expect(cohort.signoffByTask.size).toBe(3);
    expect(listParticipants).toHaveBeenCalledTimes(3);

    const ctx = { tenantId: 1, projectId: 9, policy: policy(true), runs: { spend: vi.fn(), hasRoom: () => true } as never, runTaskId: null, cohort, out: { conducted: 0, dispatched: 0 } };
    for (const t of tickets) await conductReviewTicket({} as never, db, runtime, ctx, t);
    // Still 3: the per-ticket loop reads the cohort's gate instead of resolving again.
    expect(listParticipants).toHaveBeenCalledTimes(3);
  });

  it('single-ticket reads still go through the policy-aware resolver (unchanged contract)', async () => {
    expect(await resolveRequiredSignoffGate({} as never, emptyDb(), { tenantId: 1, taskId: 1, requireSignoff: false })).toBe(SIGNOFF_NOT_REQUIRED);
  });
});
