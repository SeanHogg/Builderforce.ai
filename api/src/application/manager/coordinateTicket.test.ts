import { describe, expect, it } from 'vitest';
import { decideCoordinatedAdvance } from './coordinateTicket';

const lanes = [
  { key: 'ready', isTerminal: false },
  { key: 'in_progress', isTerminal: false },
  { key: 'validation', isTerminal: false },
  { key: 'done', isTerminal: true },
];

describe('decideCoordinatedAdvance', () => {
  it('keeps the ticket in its stage while any required role is outstanding', () => {
    expect(decideCoordinatedAdvance([
      { required: true, stageKey: 'ready', state: 'completed', roleName: 'Business Analyst' },
      { required: true, stageKey: 'ready', state: 'assigned', roleName: 'Architect' },
    ], lanes, 'ready')).toEqual({ nextStatus: null, outstanding: ['Architect'] });
  });

  it('advances exactly one lane once the current stage is satisfied', () => {
    expect(decideCoordinatedAdvance([
      { required: true, stageKey: 'ready', state: 'completed', roleName: 'Business Analyst' },
      { required: true, stageKey: 'ready', state: 'completed', roleName: 'Architect' },
      { required: true, stageKey: 'validation', state: 'assigned', roleName: 'Validator' },
    ], lanes, 'ready')).toEqual({ nextStatus: 'in_progress', outstanding: [] });
  });

  it('blocks the terminal lane until the entire manifest is satisfied', () => {
    expect(decideCoordinatedAdvance([
      { required: true, stageKey: 'validation', state: 'completed', roleName: 'Validator' },
      { required: true, stageKey: 'in_progress', state: 'assigned', roleName: 'Developer' },
    ], lanes, 'validation')).toEqual({ nextStatus: null, outstanding: ['Developer'] });
  });
});

describe('decideCoordinatedAdvance — parked lanes', () => {
  const seed = [
    { key: 'in_progress', isTerminal: false },
    { key: 'in_review', isTerminal: false },
    { key: 'blocked', isTerminal: false },
    { key: 'done', isTerminal: true },
  ];

  it('never advances a satisfied stage into the parked lane', () => {
    // The managed-board twin of the resolveNextLaneKey trap: `blocked` sits between the
    // last working lane and Done on the default layout, so a satisfied review stage was
    // advanced into the one lane autonomy refuses to scan.
    const manifest = [{ required: true, stageKey: 'in_review', state: 'completed', roleName: 'QA' }];
    expect(decideCoordinatedAdvance(manifest, seed, 'in_review').nextStatus).not.toBe('blocked');
  });

  it('skips the parked lane to reach the real next stage', () => {
    const manifest = [{ required: true, stageKey: 'in_progress', state: 'completed', roleName: 'Dev' }];
    expect(decideCoordinatedAdvance(manifest, seed, 'in_progress').nextStatus).toBe('in_review');
  });
});
