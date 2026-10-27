import { describe, expect, it } from 'vitest';
import { PINNED_OVERFLOW, selectToolsForTurn } from './selectTools';
import type { BrainToolSpec } from './streamChatCompletion';

// WS-C: a pinned tool (one the run already called — often reached through the router)
// is APPENDED beyond the cap; it never evicts a tool from the turn's fixed set, so the
// advertised list (the front of the vendor's cached prefix) only ever grows at its end.

const tool = (name: string, description = ''): BrainToolSpec => ({ type: 'function', function: { name, description, parameters: {} } });
const catalog: BrainToolSpec[] = Array.from({ length: 40 }, (_, i) => tool(`builtin_tool_${i}`, i < 10 ? 'tasks' : 'other'));
const names = (sel: { tools: BrainToolSpec[] }) => sel.tools.map((t) => t.function.name);

describe('selectToolsForTurn — pins append beyond the cap', () => {
  it('keeps the fixed set intact and adds the pin after it', () => {
    const base = selectToolsForTurn(catalog, { query: 'tasks', limit: 10 });
    const pinned = selectToolsForTurn(catalog, { query: 'tasks', limit: 10, pinned: ['builtin_tool_39'] });
    expect(names(pinned)).toEqual([...names(base), 'builtin_tool_39']);
  });

  it('a later pin only lengthens the list at its end (first-called order)', () => {
    const turn2 = selectToolsForTurn(catalog, { query: 'tasks', limit: 10, pinned: ['builtin_tool_39'] });
    const turn3 = selectToolsForTurn(catalog, { query: 'tasks', limit: 10, pinned: ['builtin_tool_39', 'builtin_tool_20'] });
    expect(names(turn3).slice(0, names(turn2).length)).toEqual(names(turn2));
    expect(names(turn3).at(-1)).toBe('builtin_tool_20');
  });

  it('a pin already in the fixed set changes nothing', () => {
    const base = selectToolsForTurn(catalog, { query: 'tasks', limit: 10 });
    const pinned = selectToolsForTurn(catalog, { query: 'tasks', limit: 10, pinned: [names(base)[0]!] });
    expect(names(pinned)).toEqual(names(base));
  });

  it('stops appending at a hard ceiling (limit + PINNED_OVERFLOW), and never evicts to make room', () => {
    const big: BrainToolSpec[] = Array.from({ length: 80 }, (_, i) => tool(`builtin_tool_${i}`, i < 10 ? 'tasks' : 'other'));
    const base = selectToolsForTurn(big, { query: 'tasks', limit: 10 });
    const pins = Array.from({ length: 40 }, (_, i) => `builtin_tool_${79 - i}`);
    const sel = selectToolsForTurn(big, { query: 'tasks', limit: 10, pinned: pins });
    expect(sel.tools).toHaveLength(10 + PINNED_OVERFLOW);
    // The fixed set is intact at the front; the earliest-called pins fill the overflow.
    expect(names(sel).slice(0, 10)).toEqual(names(base));
    expect(names(sel).slice(10)).toEqual(pins.slice(0, PINNED_OVERFLOW));
    // A pin past the ceiling on a later turn changes nothing already advertised.
    const later = selectToolsForTurn(big, { query: 'tasks', limit: 10, pinned: [...pins, 'builtin_tool_30'] });
    expect(names(later)).toEqual(names(sel));
  });
});
