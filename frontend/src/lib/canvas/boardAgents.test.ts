import { describe, expect, it } from 'vitest';
import { boardAgentOccupants, boardAgents, isTeammateOnBoard } from './boardAgents';

const card = (id: string, data: Record<string, unknown>) => ({ id, data: { kind: 'agent', ...data } });

describe('boardAgents', () => {
  it('reads every agent card, and only agent cards', () => {
    const agents = boardAgents([
      card('a', { title: 'CMO', agentRef: 'cmo-t14', agentSeat: 'CMO' }),
      { id: 'n', data: { kind: 'sticky', title: 'CMO' } },
      card('b', { title: 'Recruiter' }),
    ]);
    expect(agents).toEqual([
      { objectId: 'a', ref: 'cmo-t14', name: 'CMO', seat: 'CMO' },
      { objectId: 'b', ref: null, name: 'Recruiter', seat: null },
    ]);
  });

  it('skips a hidden placement and a card with no name', () => {
    expect(boardAgents([card('a', { title: 'CRO', placementHidden: true }), card('b', { title: '  ' })])).toEqual([]);
  });
});

describe('isTeammateOnBoard', () => {
  const cmo = { id: 'cmo-t14', name: 'Maya', seat: 'CMO' };

  it('matches the roster row a card was seated from', () => {
    expect(isTeammateOnBoard(cmo, [{ objectId: 'a', ref: 'cmo-t14', name: 'Whatever', seat: null }])).toBe(true);
  });

  /** A card Brain made from `@CMO` carries only its title — it is still the CMO. */
  it('matches a titled card to the seat, case-insensitively', () => {
    expect(isTeammateOnBoard(cmo, [{ objectId: 'a', ref: null, name: 'cmo', seat: null }])).toBe(true);
  });

  it('does not match a different teammate', () => {
    expect(isTeammateOnBoard(cmo, [{ objectId: 'a', ref: 'cro-t2', name: 'CRO', seat: 'CRO' }])).toBe(false);
  });
});

describe('boardAgentOccupants', () => {
  it('seats each agent once, as an agent', () => {
    const occupants = boardAgentOccupants([
      { objectId: 'a', ref: 'cmo-t14', name: 'CMO', seat: 'CMO' },
      { objectId: 'b', ref: 'cmo-t14', name: 'CMO', seat: 'CMO' },
      { objectId: 'c', ref: null, name: 'Recruiter', seat: null },
    ]);
    expect(occupants).toEqual([
      { userId: 'agent:cmo-t14', displayName: 'CMO', kind: 'agent' },
      { userId: 'agent:recruiter', displayName: 'Recruiter', kind: 'agent' },
    ]);
  });
});
