import { describe, expect, it } from 'vitest';
import { MAX_ADDRESSED_AGENTS, mentionTokens, mentionedBoardAgents, mentionsAny } from './agentMentions';
import type { BoardAgent } from './boardAgents';

const agent = (objectId: string, name: string, extra: Partial<BoardAgent> = {}): BoardAgent => (
  { objectId, ref: null, name, seat: null, ...extra }
);

describe('mentionsAny', () => {
  it('matches a name spaced or run together, in any case', () => {
    expect(mentionsAny('Ask @ProductDesigner to draft it', ['Product Designer'])).toBe(true);
    expect(mentionsAny('ask @product designer to draft it', ['Product Designer'])).toBe(true);
  });

  it('matches whole words only', () => {
    expect(mentionsAny('@CFO what is our runway?', ['CF'])).toBe(false);
    expect(mentionsAny('@CFO, what is our runway?', ['CFO'])).toBe(true);
  });

  it('ignores empty labels and prompts without a mention', () => {
    expect(mentionsAny('CFO what is our runway?', ['CFO'])).toBe(false);
    expect(mentionsAny('@ hello', ['', null, undefined])).toBe(false);
  });

  it('matches names outside the Latin alphabet', () => {
    expect(mentionsAny('请 @法务 审阅这份合同', ['法务'])).toBe(true);
  });
});

describe('mentionedBoardAgents', () => {
  const board = [
    agent('m', 'Manager'), agent('c', 'CFO'), agent('l', 'Counsel'), agent('r', 'Recruiter'),
    agent('x', 'Maya', { seat: 'CMO', ref: 'cmo-t14' }),
  ];

  it('returns every agent the prompt names, wherever it is on the board', () => {
    expect(mentionedBoardAgents('@Manager @CFO @Counsel run a business design session', board).map((a) => a.objectId))
      .toEqual(['m', 'c', 'l']);
  });

  it('matches a seat as well as a name', () => {
    expect(mentionedBoardAgents('@CMO thoughts?', board).map((a) => a.objectId)).toEqual(['x']);
  });

  it('is empty when nobody is named, so the turn falls back to the agents in reach', () => {
    expect(mentionedBoardAgents('Discuss the tradeoffs', board)).toEqual([]);
  });

  it('answers once for two cards naming the same agent', () => {
    expect(mentionedBoardAgents('@CFO', [agent('c1', 'CFO'), agent('c2', 'cfo')]).map((a) => a.objectId)).toEqual(['c1']);
  });

  it('caps a turn at MAX_ADDRESSED_AGENTS without confusing Agent1 with Agent10', () => {
    const many = Array.from({ length: MAX_ADDRESSED_AGENTS + 3 }, (_, index) => agent(`a${index}`, `Agent${index}`));
    const named = mentionedBoardAgents(many.map((a) => `@${a.name}`).join(' '), many);
    expect(named).toHaveLength(MAX_ADDRESSED_AGENTS);
    expect(mentionedBoardAgents('@Agent10 only', many).map((a) => a.objectId)).toEqual(['a10']);
  });
});

describe('mentionTokens', () => {
  it('addresses each agent the way a person would type it', () => {
    expect(mentionTokens([{ name: 'CMO' }, { name: 'Chief Counsel' }])).toBe('@CMO @ChiefCounsel');
  });

  it('round-trips through mentionedBoardAgents', () => {
    const board = [agent('a', 'Chief Counsel'), agent('b', 'CFO')];
    expect(mentionedBoardAgents(`${mentionTokens(board)} standup`, board)).toHaveLength(2);
  });
});
