import { describe, expect, it } from 'vitest';
import {
  computeDispositions, jaccard, retractionEvidence, titleTokens, type TicketEvidence,
} from './backlogDispositionRules';

const ticket = (over: Partial<TicketEvidence> & { id: number }): TicketEvidence => ({
  projectId: 1, title: `Unique capability number ${over.id} widget`, status: 'backlog', taskType: 'task',
  description: 'A real description with acceptance criteria that is long enough to act on.',
  prs: [], hasPrd: false, ...over,
});

const decide = (tickets: TicketEvidence[], known: number[] = []) =>
  Object.fromEntries(computeDispositions(tickets, new Set(known)).decisions.map((d) => [d.taskId, d]));

describe('close rules', () => {
  it('closes a ticket whose own text says it was closed and superseded', () => {
    const d = decide([ticket({ id: 386, description: 'The older backlog pass was closed and superseded by the new pass.' })]);
    expect(d[386]!.disposition).toBe('close');
    expect(d[386]!.evidence.rule).toBe('superseded');
  });

  it('closes retracted / hallucinated findings', () => {
    const d = decide([
      ticket({ id: 542, title: 'Security finding (retracted)' }),
      ticket({ id: 543, description: 'This finding was hallucinated; the code does not exist.' }),
    ]);
    expect(d[542]!.disposition).toBe('close');
    expect(d[543]!.disposition).toBe('close');
  });

  it('records supersededBy only when the referenced ticket is known', () => {
    const t = ticket({ id: 5, description: 'Superseded by #9 which covers it.' });
    expect(decide([t], [9])[5]!.supersededBy).toBe(9);
    expect(decide([t], [])[5]!.supersededBy).toBeNull();
    expect(retractionEvidence(t)?.supersededBy).toBe(9);
  });

  it('never closes shipped work: a merged PR keeps the ticket even if its text mentions retraction', () => {
    const d = decide([ticket({
      id: 7, description: 'Earlier approach was withdrawn; the new one shipped.',
      prs: [{ id: 'p1', number: 1, status: 'merged', buildStatus: 'success' }],
    })]);
    expect(d[7]!.disposition).toBe('keep');
    expect(d[7]!.deliveryState).toBe('implemented_unverified');
  });
});

describe('consolidate rules', () => {
  it('consolidates near-duplicate titles into the OLDEST ticket of the cluster', () => {
    const d = decide([
      ticket({ id: 1500, title: 'Participant assignment tool is missing for lane 3' }),
      ticket({ id: 1496, title: 'Participant assignment tool is missing for lane 7' }),
      ticket({ id: 1510, title: 'Participant assignment tool is missing for lane 12' }),
    ]);
    expect(d[1496]!.disposition).toBe('keep');
    expect(d[1500]!.disposition).toBe('consolidate');
    expect(d[1500]!.duplicateOf).toBe(1496);
    expect(d[1510]!.duplicateOf).toBe(1496);
  });

  it('does not consolidate across projects or task types, nor distinct titles', () => {
    const d = decide([
      ticket({ id: 1, title: 'Participant assignment tool is missing for lane 3' }),
      ticket({ id: 2, projectId: 2, title: 'Participant assignment tool is missing for lane 4' }),
      ticket({ id: 3, taskType: 'bug', title: 'Participant assignment tool is missing for lane 5' }),
      ticket({ id: 4, title: 'Marketplace escrow milestone payments for freelancers' }),
    ]);
    expect(Object.values(d).every((x) => x.disposition === 'keep')).toBe(true);
  });

  it('leaves a duplicate that has its own open PR independent (in-flight work)', () => {
    const d = decide([
      ticket({ id: 1, title: 'Participant assignment tool is missing for lane 3' }),
      ticket({ id: 2, title: 'Participant assignment tool is missing for lane 4', prs: [{ id: 'p', number: 9, status: 'open', buildStatus: null }] }),
    ]);
    expect(d[2]!.disposition).toBe('keep');
    expect(d[2]!.deliveryState).toBe('review');
  });
});

describe('quarantine rules', () => {
  it('quarantines tickets whose only PRs are closed and unmerged', () => {
    const d = decide([ticket({ id: 20, prs: [{ id: 'p', number: 3, status: 'closed', buildStatus: null }] })]);
    expect(d[20]!.disposition).toBe('quarantine');
    expect(d[20]!.evidence.rule).toBe('closed_unmerged_only');
  });

  it('keeps a ticket that has a closed PR AND a live one', () => {
    const d = decide([ticket({ id: 21, prs: [
      { id: 'a', number: 3, status: 'closed', buildStatus: null }, { id: 'b', number: 4, status: 'open', buildStatus: 'failure' },
    ] })]);
    expect(d[21]!.disposition).toBe('keep');
    expect(d[21]!.deliveryState).toBe('repair');
  });

  it('quarantines a vague ticket with no acceptance criteria and no PR', () => {
    const d = decide([ticket({ id: 30, description: 'make it better' })]);
    expect(d[30]!.disposition).toBe('quarantine');
    expect(d[30]!.evidence.rule).toBe('no_acceptance_criteria');
  });
});

describe('keep + metadata', () => {
  it('keeps a real unmet capability and classifies PRD alignment', () => {
    const d = decide([
      ticket({ id: 40, hasPrd: true }),
      ticket({ id: 41, taskType: 'gap', title: 'Delivery health persistence is missing entirely' }),
      ticket({ id: 42, title: 'Tenant isolation proof for object storage' }),
    ]);
    expect(d[40]).toMatchObject({ disposition: 'keep', prdAlignment: 'direct_prd', deliveryState: 'not_started' });
    expect(d[41]!.prdAlignment).toBe('operational_defect');
    expect(d[42]!.prdAlignment).toBe('unlinked');
  });

  it('returns exactly one decision per ticket', () => {
    const tickets = [ticket({ id: 1 }), ticket({ id: 2 }), ticket({ id: 3, description: 'x' })];
    expect(computeDispositions(tickets, new Set()).decisions.map((x) => x.taskId)).toEqual([1, 2, 3]);
  });
});

describe('titleTokens / jaccard', () => {
  it('ignores digits and stop words', () => {
    expect([...titleTokens('Gap: the #1496 tool for lane 3')]).toEqual(['tool', 'lane']);
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });
});
