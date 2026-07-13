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
