import { describe, it, expect } from 'vitest';
import { priorAttemptsFor, gradeStall, summarizeRegister, type OpenStall, type StallWatchRow } from './stallWatch';
import { diagnoseStall, MAX_REMEDY_ATTEMPTS, type StallDiagnosis } from './stallTriage';

const DAY = 86_400_000;

const unassigned: StallDiagnosis = diagnoseStall({
  status: 'todo', isTerminal: false, idleMs: 3 * DAY, everRan: false,
  autoRunReason: 'no_agent', hasLiveRun: false, readiness: null, pr: null, mergeWithheld: false,
});

const open = (over: Partial<OpenStall> = {}): OpenStall => ({
  id: 'row-1', taskId: 7, cause: 'unassigned', remedy: 'assign',
  observedStatus: 'todo', attempts: 2, lastAttemptAt: null, escalatedAt: null, ...over,
});

describe('priorAttemptsFor — grading the previous attempt', () => {
  it('starts at zero when the ticket has no open row', () => {
    expect(priorAttemptsFor(undefined, 'todo', unassigned)).toBe(0);
  });

  it('carries the count when the ticket has NOT moved since the last attempt', () => {
    expect(priorAttemptsFor(open({ attempts: 2 }), 'todo', unassigned)).toBe(2);
  });

  it('resets when the ticket moved — the remedy worked, so the budget is fresh', () => {
    // Same remedy, but the ticket is now in a different lane than when we last tried.
    expect(priorAttemptsFor(open({ attempts: 2, observedStatus: 'todo' }), 'in_progress', unassigned)).toBe(0);
  });

  it('resets when the diagnosis changed — a new remedy deserves its own budget', () => {
    // "I tried assigning it 3 times" says nothing about whether a sign-off drive works.
    expect(priorAttemptsFor(open({ attempts: 3, remedy: 'drive_signoff' }), 'todo', unassigned)).toBe(0);
  });
});

describe('gradeStall — attempts turn into escalation', () => {
  it('keeps the manager working the ticket below the ceiling', () => {
    const { verdict, priorAttempts } = gradeStall(open({ attempts: MAX_REMEDY_ATTEMPTS - 1 }), 'todo', unassigned);
    expect(priorAttempts).toBe(MAX_REMEDY_ATTEMPTS - 1);
    expect(verdict.remedy).toBe('assign');
    expect(verdict.escalated).toBe(false);
  });

  it('hands the ticket to a human once the remedy has provably not worked', () => {
    const { verdict } = gradeStall(open({ attempts: MAX_REMEDY_ATTEMPTS }), 'todo', unassigned);
    expect(verdict.remedy).toBe('escalate_human');
    expect(verdict.escalated).toBe(true);
  });

  it('a ticket that moved gets a fresh budget rather than an escalation', () => {
    // This is the anti-livelock property: progress always resets the ceiling, so a
    // remedy that IS working is never mistaken for one that is not.
    const { verdict, priorAttempts } = gradeStall(open({ attempts: 99 }), 'in_progress', unassigned);
    expect(priorAttempts).toBe(0);
    expect(verdict.escalated).toBe(false);
  });
});

describe('summarizeRegister', () => {
  const row = (over: Partial<StallWatchRow> = {}): StallWatchRow => ({
    taskId: 1, title: 't', status: 'todo', cause: 'unassigned', remedy: 'assign',
    detail: 'd', attempts: 1, idleMs: DAY, firstSeenAt: new Date(), lastSeenAt: new Date(),
    lastAttemptAt: null, escalatedAt: null, ...over,
  });

  it('splits what the manager is working from what it handed over', () => {
    const s = summarizeRegister([
      row({ taskId: 1 }),
      row({ taskId: 2, escalatedAt: new Date() }),
      row({ taskId: 3, escalatedAt: new Date() }),
    ]);
    expect(s.escalated).toBe(2);
    expect(s.working).toBe(1);
  });

  it('ranks causes by how many tickets they hold up', () => {
    const s = summarizeRegister([
      row({ taskId: 1, cause: 'never_started' }),
      row({ taskId: 2, cause: 'never_started' }),
      row({ taskId: 3, cause: 'awaiting_signoff' }),
    ]);
    expect(s.byCause[0]).toEqual({ cause: 'never_started', count: 2 });
    expect(s.byCause[1]).toEqual({ cause: 'awaiting_signoff', count: 1 });
  });

  it('ships the ceiling so a reader can compare attempts without duplicating it', () => {
    expect(summarizeRegister([]).maxAttempts).toBe(MAX_REMEDY_ATTEMPTS);
  });

  it('is empty-safe', () => {
    expect(summarizeRegister([])).toMatchObject({ escalated: 0, working: 0, byCause: [] });
  });
});
