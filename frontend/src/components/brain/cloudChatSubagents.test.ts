import { describe, expect, it } from 'vitest';
import { asChatSubagents, runHistoryHasSubagents } from './cloudChatSubagents';

const bob = { key: '42', handle: 'a42', name: 'Bob', label: 'port auth', owner: 'Ada' };

describe('asChatSubagents', () => {
  it('reads well-formed subagents off a runs payload', () => {
    expect(asChatSubagents({ runs: [], subagents: [bob] })).toEqual([bob]);
  });

  it('drops malformed rows and missing lists', () => {
    expect(asChatSubagents({ subagents: [{ ...bob, handle: '' }, bob, { key: 42 }] })).toEqual([bob]);
    expect(asChatSubagents({ runs: [] })).toEqual([]);
    expect(asChatSubagents(null)).toEqual([]);
    expect(asChatSubagents(undefined)).toEqual([]);
  });
});

describe('runHistoryHasSubagents', () => {
  it('is true only when the field is present, so a failed poll does not look empty', () => {
    expect(runHistoryHasSubagents({ subagents: [] })).toBe(true);
    expect(runHistoryHasSubagents({ subagents: [bob] })).toBe(true);
    expect(runHistoryHasSubagents({ linkedRunnableTickets: 0, runs: [], dispatchers: [], executors: [] })).toBe(false);
    expect(runHistoryHasSubagents(null)).toBe(false);
    expect(runHistoryHasSubagents(undefined)).toBe(false);
  });
});
