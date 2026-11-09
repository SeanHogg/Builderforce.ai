import { beforeEach, describe, expect, it } from 'vitest';
import { resetBrainRunStore, startRun } from '../brainRunStore';
import { brainRunPolicy } from './webAdapter';

// Chat #61651: most turns issued 1–2 calls even when the next reads were independent, and the reads the model DID
// batch ran one after another — the Brain's run policy switched no guard lever on, so the kernel's D8 port
// (`isReadOnly`) answered "no" for every call. The independent read-only calls of one model turn now dispatch
// concurrently; a mutating call still runs alone, after them, in the order the model gave.

beforeEach(resetBrainRunStore);

const persistence = () => ({
  sendMessages: async (chatId: number, msgs: Array<{ role: string; content: string }>) => msgs.map((m, i) => ({ id: 9100 + i, chatId, createdAt: '', ...m })),
}) as never;

const TOOLS = ['read_file', 'search_code', 'list_files', 'write_file'].map((name) => ({
  type: 'function' as const,
  function: { name, description: name, parameters: {} },
}));

type Call = { id: string; name: string; args: string };

/** One scripted turn of `calls`, then a closing answer; records how many tool runs were in flight at once and the order they ended. */
async function runTurn(chatId: number, calls: Call[]) {
  let inFlight = 0;
  let peak = 0;
  const events: string[] = [];
  let turn = 0;
  await startRun(chatId, {
    resolvedSystemPrompt: 'sys',
    tools: TOOLS,
    runTool: async (name: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      events.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      events.push(`end:${name}`);
      return { ok: true, content: `${name} result` };
    },
    stream: async () => {
      turn += 1;
      // Twice: a planning turn's first code change is re-asked of the coder (`reask_as_coder`), which answers with the same calls.
      return turn <= 2
        ? { text: '', toolCalls: calls, finishReason: 'tool_calls' }
        : { text: 'Done.', toolCalls: [], finishReason: 'stop' };
    },
    persistence: persistence(),
    userTurn: 'look at the three files',
  });
  return { peak, events };
}

describe('the Brain runs one turn\'s independent reads concurrently (D8)', () => {
  it('switches the parallel-reads lever on in the run policy', () => {
    const policy = brainRunPolicy({ entryPoint: 'vscode', req: { resolvedSystemPrompt: 'sys' } as never, request: 'x' });
    expect(policy.levers).toContain('d8_parallel_tool_calls');
  });

  it('dispatches independent read-only calls together', async () => {
    const { peak } = await runTurn(4801, [
      { id: 'r1', name: 'read_file', args: JSON.stringify({ path: 'a.ts' }) },
      { id: 'r2', name: 'read_file', args: JSON.stringify({ path: 'b.ts' }) },
      { id: 's1', name: 'search_code', args: JSON.stringify({ query: 'needle' }) },
    ]);
    expect(peak).toBeGreaterThanOrEqual(2);
  });

  it('keeps a mutating call in order: it starts only after the reads before it ended', async () => {
    const { events } = await runTurn(4802, [
      { id: 'r1', name: 'read_file', args: JSON.stringify({ path: 'a.ts' }) },
      { id: 'r2', name: 'list_files', args: JSON.stringify({ path: '.' }) },
      { id: 'w1', name: 'write_file', args: JSON.stringify({ path: 'c.ts', content: 'x' }) },
    ]);
    const writeStart = events.indexOf('start:write_file');
    expect(writeStart).toBeGreaterThan(0);
    expect(events.slice(0, writeStart)).toEqual(expect.arrayContaining(['end:read_file', 'end:list_files']));
    expect(events.filter((e) => e.startsWith('start:')).slice(0, 2).sort()).toEqual(['start:list_files', 'start:read_file']);
  });
});
