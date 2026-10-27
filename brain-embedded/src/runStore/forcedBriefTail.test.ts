/**
 * WS-C: a forced turn's brief rides the turn's ONE tagged `<run-state>` tail, LAST — it
 * is never an untagged message of its own in front of the tail, where the gateway's
 * history breakpoint would land on it and the next turn would miss the cache.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { isVolatileContent } from '@seanhogg/builderforce-memory/handoff';
import { PLAN_TURN_BUDGET } from '@builderforce/run-policy';
import { resetBrainRunStore, startRun, type BrainStreamFn } from '../brainRunStore';
import type { ChatCompletionMessage } from '../streamChatCompletion';

beforeEach(resetBrainRunStore);

const REQUEST = 'remove the title from the top of the VSIX';
const spec = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: {} } });
const TOOLS = [spec('read_file'), spec('edit_file')];

interface Seen {
  tools: string[];
  messages: ChatCompletionMessage[];
}

/** Reads every turn while planning (ignoring the forced hand-off too), edits once coding. */
function paralysedPlanner(seen: Seen[]): BrainStreamFn {
  let reads = 0;
  let edited = false;
  return async (opts) => {
    const tools = (opts.tools ?? []).map((t) => t.function.name);
    seen.push({ tools, messages: opts.messages as ChatCompletionMessage[] });
    if (opts.role === 'plan' || (tools.length === 1 && tools[0] === 'hand_off')) {
      reads += 1;
      return { text: '', toolCalls: [{ id: `r${reads}`, name: 'read_file', args: JSON.stringify({ path: `src/f${reads}.ts` }) }], finishReason: 'tool_calls' };
    }
    if (opts.tools && !edited) {
      edited = true;
      return { text: '', toolCalls: [{ id: 'e1', name: 'edit_file', args: JSON.stringify({ path: 'a.ts', old: 'a', new: 'b' }) }], finishReason: 'tool_calls' };
    }
    return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
  };
}

const host = async (name: string): Promise<unknown> => (name === 'read_file' ? { ok: true, content: 'export const x = 1;' } : { ok: true });

describe('the forced-turn brief is part of the tagged volatile tail', () => {
  it('sends ONE tagged tail, last, carrying the brief — and no untagged brief before it', async () => {
    const seen: Seen[] = [];
    await startRun(7301, {
      resolvedSystemPrompt: 'sys',
      tools: TOOLS,
      runTool: host,
      stream: paralysedPlanner(seen),
      persistence: { sendMessages: async () => [] },
      userTurn: REQUEST,
    });
    const forced = seen.findIndex((t) => t.tools.length === 1 && t.tools[0] === 'hand_off');
    expect(forced).toBe(PLAN_TURN_BUDGET);
    const messages = seen[forced]!.messages;
    const last = messages[messages.length - 1]!;
    expect(isVolatileContent(last.content)).toBe(true);
    expect(String(last.content)).toContain('hand_off');
    // Exactly one per-request block, and nothing untagged after the history carries the brief.
    expect(messages.filter((m) => isVolatileContent(m.content))).toHaveLength(1);
    const beforeTail = messages[messages.length - 2]!;
    expect(String(beforeTail.content)).not.toContain('ANALYSIS IS OVER');
  });

  it('a normal turn sends the same single tail with no brief in it', async () => {
    const seen: Seen[] = [];
    await startRun(7302, {
      resolvedSystemPrompt: 'sys',
      tools: TOOLS,
      runTool: host,
      stream: paralysedPlanner(seen),
      persistence: { sendMessages: async () => [] },
      userTurn: REQUEST,
    });
    const tails = seen[1]!.messages.filter((m) => isVolatileContent(m.content));
    expect(tails.length).toBeLessThanOrEqual(1);
    for (const t of tails) expect(String(t.content)).not.toContain('ANALYSIS IS OVER');
  });
});
