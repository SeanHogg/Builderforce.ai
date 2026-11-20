import { describe, it, expect } from 'vitest';
import { CLAIMED_COMPLETE_PROGRESS_CAP, effectiveTicketProgress, isExcludedFromChatHealth, rollupChatTicketHealth } from './chatTicketHealth';
import { TASK_CLOSED_STATUSES } from './taskClosedState';
import {
  checkTicketStatus,
  isCancelledTicketStatus,
  isClosedTicketStatus,
  parseTicketStatus,
  TICKET_CLOSED_STATES,
  TICKET_STATUS_ALIASES,
  TICKET_STATUS_VALUES,
  type TicketStatusKind,
} from './ticketClosedStates';

/**
 * "Exact 100 is the only completion signal, and only a CLOSED ticket emits it" — for
 * every chat ticket kind, each closed by its OWN status words (ticketClosedStates.ts).
 */

/** Kind → one status that is still open, and one that is closed, from each kind's source vocabulary. */
const KINDS: ReadonlyArray<{ kind: string; open: string; closed: string }> = [
  { kind: 'task', open: 'in_progress', closed: 'done' },
  { kind: 'gap', open: 'in_review', closed: 'done' },
  { kind: 'epic', open: 'in_progress', closed: 'done' },
  { kind: 'initiative', open: 'active', closed: 'completed' },
  { kind: 'portfolio', open: 'active', closed: 'archived' },
  { kind: 'objective', open: 'active', closed: 'achieved' },
  { kind: 'roadmap', open: 'in_progress', closed: 'shipped' },
  { kind: 'spec', open: 'in_progress', closed: 'complete' },
  { kind: 'retro', open: 'active', closed: 'completed' },
  { kind: 'poker', open: 'active', closed: 'completed' },
];

describe('TICKET_CLOSED_STATES', () => {
  it('every registered kind has an open/closed case below (the api test checks every TICKET_KINDS member is registered)', () => {
    const covered = new Set(KINDS.map((k) => k.kind));
    for (const kind of Object.keys(TICKET_CLOSED_STATES)) expect(covered, kind).toContain(kind);
  });

  it('every closed word is a value of its column vocabulary or one of its legacy aliases', () => {
    for (const kind of Object.keys(TICKET_STATUS_VALUES) as TicketStatusKind[]) {
      const accepted = [...TICKET_STATUS_VALUES[kind], ...Object.keys(TICKET_STATUS_ALIASES[kind] ?? {})];
      for (const word of TICKET_CLOSED_STATES[kind]?.closed ?? []) expect(accepted, `${kind}:${word}`).toContain(word);
    }
  });

  it('every write vocabulary can say cancelled, and it keeps the rollup skip', () => {
    for (const kind of Object.keys(TICKET_STATUS_VALUES) as TicketStatusKind[]) {
      expect(TICKET_STATUS_VALUES[kind] as readonly string[], kind).toContain('cancelled');
      expect(isCancelledTicketStatus(kind, 'cancelled')).toBe(true);
    }
  });

  it('parseTicketStatus accepts a known value (case-insensitive) and rejects an unknown one naming the allowed values', () => {
    expect(parseTicketStatus('initiative', 'Completed')).toBe('completed');
    expect(() => parseTicketStatus('initiative', 'done')).toThrow('initiative status must be one of: proposed, active, completed, archived, cancelled');
  });

  it('a legacy roadmap spelling is accepted as input and stored as shipped; the tools advertise only the vocabulary', () => {
    for (const word of ['done', 'complete', 'completed', 'Released']) expect(parseTicketStatus('roadmap', word)).toBe('shipped');
    expect(TICKET_STATUS_VALUES.roadmap).toEqual(['planned', 'in_progress', 'shipped', 'cancelled']);
  });

  it('a null status is refused with a clear message', () => {
    expect(checkTicketStatus('portfolio', null)).toEqual({ ok: false, error: 'portfolio status cannot be null' });
    expect(() => parseTicketStatus('roadmap', undefined)).toThrow('roadmap status cannot be null');
  });

  it('an update that keeps the stored status passes it through untouched, even off-vocabulary', () => {
    expect(checkTicketStatus('roadmap', 'In Progress', 'in progress')).toEqual({ ok: true, value: 'in progress' });
    expect(parseTicketStatus('roadmap', 'released', 'released')).toBe('released');
    // A CHANGE is still held to the vocabulary.
    expect(checkTicketStatus('roadmap', 'wip', 'in progress').ok).toBe(false);
    expect(parseTicketStatus('roadmap', 'shipped', 'in progress')).toBe('shipped');
  });

  it('task-tier kinds reuse TASK_CLOSED_STATUSES (no copy)', () => {
    for (const kind of ['task', 'gap', 'epic']) expect(TICKET_CLOSED_STATES[kind]?.closed).toBe(TASK_CLOSED_STATUSES);
  });

  it('every cancelled word is also closed', () => {
    for (const [kind, v] of Object.entries(TICKET_CLOSED_STATES)) {
      for (const word of v.cancelled) expect(v.closed, `${kind}:${word}`).toContain(word);
    }
  });
});

describe('effectiveTicketProgress per kind', () => {
  for (const { kind, open, closed } of KINDS) {
    it(`regression: an active ${kind} with every child done reads the claimed-complete rung, not 100`, () => {
      expect(effectiveTicketProgress(open, 100, kind)).toBe(CLAIMED_COMPLETE_PROGRESS_CAP);
      // The cap never raises a lower figure.
      expect(effectiveTicketProgress(open, 40, kind)).toBe(40);
    });

    it(`a ${kind} closed in its own vocabulary ("${closed}") reads 100 whatever its raw figure`, () => {
      expect(effectiveTicketProgress(closed, 100, kind)).toBe(100);
      expect(effectiveTicketProgress(closed, 30, kind)).toBe(100);
    });
  }

  it('is case-insensitive on status and kind', () => {
    expect(effectiveTicketProgress('Complete', 100, 'SPEC')).toBe(100);
    expect(effectiveTicketProgress('Active', 100, 'Initiative')).toBe(CLAIMED_COMPLETE_PROGRESS_CAP);
  });

  it('a kind with no declared vocabulary keeps the floor-only behaviour (never capped)', () => {
    expect(effectiveTicketProgress('active', 100, 'okr-thing')).toBe(100);
    expect(effectiveTicketProgress('done', 40, 'okr-thing')).toBe(100);
    expect(effectiveTicketProgress('active', 100, null)).toBe(100);
  });

  it('a task lane word does not close another kind: a spec cannot be "done"', () => {
    expect(isClosedTicketStatus('spec', 'done')).toBe(false);
    expect(isClosedTicketStatus('initiative', 'active')).toBe(false);
  });

  it('the shared cancelled spellings are closed for every kind', () => {
    for (const { kind } of KINDS) {
      expect(isClosedTicketStatus(kind, 'cancelled')).toBe(true);
      expect(isCancelledTicketStatus(kind, 'canceled')).toBe(true);
    }
  });
});

describe('rollupChatTicketHealth with kinds', () => {
  it('regression: an active initiative with every child done does not complete the chat', () => {
    const health = rollupChatTicketHealth([{ kind: 'initiative', status: 'active', progressPct: 100, done: 4, total: 4 }]);
    expect(health).toMatchObject({ pct: CLAIMED_COMPLETE_PROGRESS_CAP, openTickets: 1, completedTickets: 0 });
  });

  it('a spec "complete" and a roadmap "shipped" count as completed', () => {
    const health = rollupChatTicketHealth([
      { kind: 'spec', status: 'complete', progressPct: 100, done: 1, total: 1 },
      { kind: 'roadmap', status: 'shipped', progressPct: 0, done: 0, total: 1 },
    ]);
    expect(health).toMatchObject({ pct: 100, openTickets: 0, completedTickets: 2 });
  });

  it("skips a kind's own cancelled word (a missed objective) like a cancelled lane", () => {
    expect(isExcludedFromChatHealth('missed', 'objective')).toBe(true);
    expect(isExcludedFromChatHealth('missed')).toBe(false);
    const health = rollupChatTicketHealth([
      { kind: 'objective', status: 'missed', progressPct: 20, done: 0, total: 3 },
      { kind: 'task', status: 'done', progressPct: 100, done: 1, total: 1 },
    ]);
    expect(health).toEqual({ pct: 100, done: 1, total: 1, openTickets: 0, completedTickets: 1 });
  });

  it('an input without a kind keeps the floor-only behaviour', () => {
    expect(rollupChatTicketHealth([{ status: 'active', progressPct: 100, done: 1, total: 1 }]).pct).toBe(100);
  });
});
