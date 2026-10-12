import { describe, expect, it } from 'vitest';
import { asChatSubagents } from './cloudChatSubagents';

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
