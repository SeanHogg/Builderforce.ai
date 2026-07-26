import { describe, it, expect, vi, beforeEach } from 'vitest';
import { driveOutstandingSignoffs, pickSignoffCandidate } from './driveSignoffs';
import { requestRoleRun } from './requestRoleRun';
import { classifySignoffOwnership, decideSignoffGate, type OutstandingSlot } from './signoffGate';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';

vi.mock('./requestRoleRun', () => ({ requestRoleRun: vi.fn() }));

const mockRequestRoleRun = vi.mocked(requestRoleRun);

const slot = (over: Partial<OutstandingSlot> = {}): OutstandingSlot => ({
  roleKey: 'architect', roleName: 'Architect', stageKey: 'in_review', state: 'assigned',
  responsibility: 'reviewer',
  assigneeName: 'Arch Agent', assigneeRef: 'agent-1', assigneeKind: 'agent', ...over,
});

const pick = (slots: OutstandingSlot[]) => pickSignoffCandidate(classifySignoffOwnership(slots));

describe('pickSignoffCandidate', () => {
  it('asks a role nobody has asked yet before re-asking one already dispatched', () => {
    // The bug this encodes: `in_progress` means "already asked and still unanswered",
    // and such a slot stays OUTSTANDING. Taking the first outstanding slot therefore
    // re-asked one role forever while the other nine were never asked once — a 10-slot
    // gate that no number of passes could satisfy.
    const chosen = pick([
      slot({ roleKey: 'architect', state: 'in_progress' }),
      slot({ roleKey: 'developer', roleName: 'Developer', state: 'assigned', assigneeRef: 'agent-2' }),
    ]);
    expect(chosen?.roleKey).toBe('developer');
  });

  it('falls back to re-asking once every agent-owed slot has had its turn', () => {
    const chosen = pick([
      slot({ roleKey: 'architect', state: 'in_progress' }),
      slot({ roleKey: 'developer', roleName: 'Developer', state: 'in_progress', assigneeRef: 'agent-2' }),
    ]);
    expect(chosen?.roleKey).toBe('architect');
  });

  it('never picks a slot the manager cannot dispatch', () => {
    expect(pick([
      slot({ assigneeKind: 'human', assigneeRef: 'u:sean' }),
      slot({ roleKey: 'qa-tester', assigneeKind: null, assigneeRef: null }),
    ])).toBeNull();
    expect(pick([])).toBeNull();
  });
});

describe('driveOutstandingSignoffs', () => {
  const env = {} as Env;
  const db = {} as Db;
  const runtime = {} as RuntimeService;
  const task = { id: 169, title: 'Epic: Code Analysis', status: 'in_review', githubPrUrl: null };

  const gate = (slots: OutstandingSlot[]) => decideSignoffGate(
    slots.map((s) => ({
      required: true, roleKey: s.roleKey, roleName: s.roleName, stageKey: s.stageKey, state: s.state,
      responsibility: s.responsibility,
      assigneeName: s.assigneeName, assigneeRef: s.assigneeRef, assigneeKind: s.assigneeKind,
    })) as never,
  );

  const drive = (slots: OutstandingSlot[]) => driveOutstandingSignoffs(env, db, runtime, {
    tenantId: 1, projectId: 11, task, signoff: gate(slots), managerRef: 'mgr',
  });

  beforeEach(() => mockRequestRoleRun.mockReset());

  it('reports the role as asked once a run actually started', async () => {
    mockRequestRoleRun.mockResolvedValue(4813);

    const result = await drive([slot()]);

    expect(result.asked).toEqual(['Architect']);
    expect(mockRequestRoleRun).toHaveBeenCalledWith(env, db, runtime, expect.anything(), expect.objectContaining({
      taskId: 169, roleKey: 'architect', laneKey: 'in_review', kind: 'reviewer',
    }));
  });

  /**
   * The reporting bug: a refusal (failure breaker / re-run cooldown / cloud-run cap)
   * returns null, and this used to report `asked` anyway — so the feed claimed the
   * reviewer had been requested and the caller counted a remedy attempt that never
   * happened, which is how a ticket sat at "0 of 3 tries" for 26 days.
   */
  it('does NOT report an ask when the dispatcher refused the run', async () => {
    mockRequestRoleRun.mockResolvedValue(null);

    const result = await drive([slot()]);

    expect(result.asked).toEqual([]);
    expect(result.dispatchable).toBe(true);
    expect(result.blockedDetail).toMatch(/refused/i);
  });

  /**
   * Off the review lane the owed slot is usually the stage's PRODUCER. It used to get
   * the reviewer instruction — "review the delivered work and record a verdict" — for a
   * deliverable it was itself supposed to write.
   */
  it('sends an owner slot the PRODUCER contract, not a review request', async () => {
    mockRequestRoleRun.mockResolvedValue(7);

    await drive([slot({ roleKey: 'business-analyst', roleName: 'Business Analyst', responsibility: 'owner', stageKey: 'requirements' })]);

    expect(mockRequestRoleRun).toHaveBeenCalledWith(env, db, runtime, expect.anything(), expect.objectContaining({
      roleKey: 'business-analyst', kind: 'producer', laneKey: 'requirements',
    }));
  });

  it('asks nobody — and says why — when every outstanding role is human-owed', async () => {
    const result = await drive([slot({ assigneeKind: 'human', assigneeRef: 'u:sean', assigneeName: 'Sean' })]);

    expect(result.asked).toEqual([]);
    expect(result.dispatchable).toBe(false);
    expect(mockRequestRoleRun).not.toHaveBeenCalled();
  });
});
