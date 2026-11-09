import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRunSnapshot, resetBrainRunStore, startRun, subscribeRun } from '../brainRunStore';
import { BETWEEN_TURNS_LABEL } from '../runActivity';
import { brainRunPolicy } from './webAdapter';

// The working-context check that decides between a "duplicate" stub and a cache replay. Off: the real one. On: only a row that is
// itself a cache replay counts as still in context, so a read's first result reads as compacted away and is replayed from the cache.
const workingContext = vi.hoisted(() => ({ onlyReplaysLive: false }));
vi.mock('@seanhogg/builderforce-memory/working', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seanhogg/builderforce-memory/working')>();
  return {
    ...actual,
    stillInWorkingContext: (...args: Parameters<typeof actual.stillInWorkingContext>) => {
      if (!workingContext.onlyReplaysLive) return actual.stillInWorkingContext(...args);
      const anchor = args[1] as { content?: unknown } | undefined;
      return String(anchor?.content ?? '').includes('Replayed from this run');
    },
  };
});

// Chat #61651: most turns issued 1–2 calls even when the next reads were independent, and the reads the model DID
// batch ran one after another — the Brain's run policy switched no guard lever on, so the kernel's D8 port
// (`isReadOnly`) answered "no" for every call. The independent read-only calls of one model turn now dispatch
// concurrently; a mutating call still runs alone, after them, in the order the model gave.

beforeEach(() => {
  resetBrainRunStore();
  workingContext.onlyReplaysLive = false;
});

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
    const { peak, events } = await runTurn(4801, [
      { id: 'r1', name: 'read_file', args: JSON.stringify({ path: 'a.ts' }) },
      { id: 'r2', name: 'read_file', args: JSON.stringify({ path: 'b.ts' }) },
      { id: 's1', name: 'search_code', args: JSON.stringify({ query: 'needle' }) },
    ]);
    expect(peak).toBeGreaterThanOrEqual(2);
    // Two independent reads start in the SAME batch — neither waits for the other to end.
    const starts = events.filter((e) => e.startsWith('start:'));
    expect(starts.slice(0, 2).sort()).toEqual(['start:read_file', 'start:read_file']);
    expect(events.indexOf('end:read_file')).toBeGreaterThan(events.indexOf('start:read_file'));
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

/** A read whose content names its own file; b.ts is the slow one, so a.ts returns while b.ts is still running. */
const DELAY: Record<string, number> = { 'a.ts': 5, 'b.ts': 40, 'c.ts': 5 };
const read = (id: string, path: string): Call => ({ id, name: 'read_file', args: JSON.stringify({ path }) });

describe('each call of a parallel read batch keeps its OWN state (D8)', () => {
  it('regression: two parallel reads each trace and cache their own content, a cache-replayed read keeps its record', async () => {
    workingContext.onlyReplaysLive = true;
    const ranPaths: string[] = [];
    let lastMessages: Array<{ role: string; content?: unknown; tool_call_id?: string }> = [];
    let turn = 0;
    const script: Call[][] = [
      [read('a1', 'a.ts'), read('b1', 'b.ts')],
      // a.ts is answered from the read cache (its first row reads as compacted away) while c.ts runs beside it.
      [read('a2', 'a.ts'), read('c2', 'c.ts')],
      // The replay of a.ts above is now the row carrying it, still in context: an exact repeat is a stub, not another replay.
      [read('a3', 'a.ts')],
    ];
    await startRun(4803, {
      resolvedSystemPrompt: 'sys',
      tools: TOOLS,
      runTool: async (_name: string, args: unknown) => {
        const path = String((args as { path?: unknown }).path);
        ranPaths.push(path);
        await new Promise((resolve) => setTimeout(resolve, DELAY[path] ?? 5));
        return { ok: true, path, content: `content of ${path}` };
      },
      stream: async (opts) => {
        lastMessages = opts.messages as typeof lastMessages;
        if (opts.tools === undefined) return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
        const calls = script[turn];
        turn += 1;
        return calls ? { text: '', toolCalls: calls, finishReason: 'tool_calls' } : { text: 'Done.', toolCalls: [], finishReason: 'stop' };
      },
      persistence: persistence(),
      userTurn: 'read the files',
    });

    // Each file reached the disk once: a.ts's re-reads were served by the run, never re-run.
    expect(ranPaths.sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);

    // The trace: every step the host ran records ITS OWN file's content under ITS OWN args.
    const ranSteps = getRunSnapshot(4803).trace
      .filter((e) => e.category === 'tool' && e.label === 'read_file')
      .filter((e) => typeof (e.result as { content?: unknown } | null)?.content === 'string');
    expect(ranSteps.map((e) => (e.args as { path: string }).path).sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    for (const step of ranSteps) {
      expect((step.result as { content: string }).content).toBe(`content of ${(step.args as { path: string }).path}`);
    }

    const row = (id: string) => String(lastMessages.find((m) => m.role === 'tool' && m.tool_call_id === id)?.content ?? '');
    // The read cache held a.ts's OWN content under a.ts's key: the replay served it, not b.ts's.
    expect(row('a2')).toContain('Replayed from this run');
    expect(row('a2')).toContain('content of a.ts');
    expect(row('a2')).not.toContain('content of b.ts');
    expect(row('c2')).toContain('content of c.ts');
    // The replay's record survived its sibling's preflight: it re-anchored to the replay row, so the repeat is a stub.
    expect(row('a3')).toContain('Duplicate read_file call');
    expect(row('a3')).not.toContain('content of c.ts');
  });

  it('regression: the live step does not flip to between-turns while a sibling call is still running', async () => {
    let bRunning = false;
    const flippedEarly: string[] = [];
    const afterA: Array<string | undefined> = [];
    let aDone = false;
    const unsubscribe = subscribeRun(4804, () => {
      const a = getRunSnapshot(4804).activity;
      if (bRunning && a?.label === BETWEEN_TURNS_LABEL) flippedEarly.push(a.label);
      if (aDone && bRunning) afterA.push(a?.detail);
    });
    let turn = 0;
    await startRun(4804, {
      resolvedSystemPrompt: 'sys',
      tools: TOOLS,
      runTool: async (_name: string, args: unknown) => {
        const path = String((args as { path?: unknown }).path);
        if (path === 'b.ts') bRunning = true;
        await new Promise((resolve) => setTimeout(resolve, DELAY[path] ?? 5));
        if (path === 'a.ts') aDone = true;
        if (path === 'b.ts') bRunning = false;
        return { ok: true, path, content: `content of ${path}` };
      },
      stream: async (opts) => {
        if (opts.tools === undefined) return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
        turn += 1;
        return turn === 1
          ? { text: '', toolCalls: [read('a1', 'a.ts'), read('b1', 'b.ts')], finishReason: 'tool_calls' }
          : { text: 'Done.', toolCalls: [], finishReason: 'stop' };
      },
      persistence: persistence(),
      userTurn: 'read both files',
    });
    unsubscribe();

    expect(aDone).toBe(true);
    expect(flippedEarly).toEqual([]);
    // Once a.ts returned, the live step is the sibling still running: b.ts.
    expect(afterA.length).toBeGreaterThan(0);
    expect(afterA.every((detail) => String(detail).includes('b.ts'))).toBe(true);
  });
});
