import { beforeEach, describe, expect, it } from 'vitest';
import { windowFileContent } from '@builderforce/agent-tools';
import { resetBrainRunStore, startRun } from './brainRunStore';

/**
 * PRD 35 E1, through the whole run pipeline (dispatch → trim → afterDispatch cache →
 * beforeDispatch coverage). The 2026-10-25 run read a 534-line PRD whose result the
 * transcript budget cut to ~250 lines, then asked for offset 251 — and was told those
 * lines were "already returned", because coverage trusted the UNTRIMMED result
 * (`truncated:false`, `totalLines:534`). A covered replay also re-served the covering
 * read from its own first line instead of the requested one.
 */

beforeEach(resetBrainRunStore);

const persistence = { sendMessages: async () => [] };
const TOOLS = [{ type: 'function' as const, function: { name: 'read_file', description: 'read', parameters: {} } }];
const PRD = 'docs/specs/35-prd-one-agent-one-kernel.md';
/** 534 lines of ~63 JSON chars each: the 16K read budget serves ~250 of them. */
const PRD_BODY = Array.from({ length: 534 }, (_, i) => `line ${i + 1} ${'x'.repeat(52)}`).join('\n');
const OTHER_BODY = Array.from({ length: 800 }, (_, i) => `line ${i + 1} ${'x'.repeat(60)}`).join('\n');

/** The shared tool's own windowing, so offsets behave exactly as on a real surface. */
function readTool(executed: Array<{ path: string; offset: number }>) {
  return async (_name: string, args: unknown) => {
    const a = args as { path: string; offset?: number; limit?: number };
    const body = a.path === PRD ? PRD_BODY : OTHER_BODY;
    const w = windowFileContent(body, { offset: a.offset, limit: a.limit });
    executed.push({ path: a.path, offset: w.offset });
    return { ok: true, path: a.path, content: w.content, truncated: w.truncated, totalLines: w.totalLines, offset: w.offset };
  };
}

const call = (turn: number, args: Record<string, unknown>) => ({
  text: '',
  toolCalls: [{ id: `c${turn}`, name: 'read_file', args: JSON.stringify(args) }],
  finishReason: 'tool_calls' as const,
});

describe('read coverage records what the model was SERVED (PRD 35 E1)', () => {
  it('runs the read at offset 251 after a first read trimmed to ~250 lines', async () => {
    const executed: Array<{ path: string; offset: number }> = [];
    const toolMessages: string[] = [];
    let turn = 0;
    await startRun(3501, {
      resolvedSystemPrompt: 'sys',
      tools: TOOLS,
      runTool: readTool(executed),
      stream: async (opts) => {
        if (opts.tools === undefined) return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
        turn += 1;
        if (turn === 1) return call(turn, { path: PRD });
        if (turn === 2) return call(turn, { path: PRD, offset: 251, limit: 100 });
        for (const m of opts.messages) if (m.role === 'tool') toolMessages.push(String(m.content));
        return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
      },
      persistence,
      userTurn: 'update the PRD',
    });
    const first = JSON.parse(toolMessages[0]!) as { content: string; offset: number; truncated: boolean };
    const lastServed = first.offset + first.content.split('\n').length - 1;
    expect(first.truncated).toBe(true);
    expect(lastServed).toBeLessThan(251);
    // The second read reached the disk — it was NOT stubbed as "already returned".
    expect(executed.map((e) => e.offset)).toEqual([1, 251]);
    const second = JSON.parse(toolMessages[1]!) as { content: string; offset: number };
    expect(second.offset).toBe(251);
    expect(second.content.split('\n')[0]).toMatch(/^line 251 /);
  });

  it('counts a read-only shell print of the file as a read of those lines', async () => {
    const executed: string[] = [];
    let turn = 0;
    const lines = PRD_BODY.split('\n');
    await startRun(3503, {
      resolvedSystemPrompt: 'sys',
      tools: [...TOOLS, { type: 'function' as const, function: { name: 'run_command', description: 'shell', parameters: {} } }],
      runTool: async (name, args) => {
        executed.push(name);
        // 50 lines: small enough that the model is handed the print WHOLE.
        if (name === 'run_command') return { ok: true, exitCode: 0, stdout: `${lines.slice(0, 50).join('\n')}\n` };
        return readTool([])(name, args);
      },
      stream: async (opts) => {
        if (opts.tools === undefined) return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
        turn += 1;
        if (turn === 1) return { text: '', toolCalls: [{ id: 'c1', name: 'run_command', args: JSON.stringify({ command: `sed -n '1,50p' ${PRD}` }) }], finishReason: 'tool_calls' };
        if (turn === 2) return call(turn, { path: PRD, offset: 20, limit: 30 });
        if (turn === 3) return call(turn, { path: PRD, offset: 101, limit: 30 });
        return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
      },
      persistence,
      userTurn: 'update the PRD',
    });
    // Lines 20–49 were printed by the shell: covered, not read again. 101+ were not.    expect(executed.filter((n) => n === 'read_file' || n === 'run_command')).toEqual(['run_command', 'read_file']);
  });

  it('replays a covered read at the REQUESTED offset once compaction dropped the covering read', async () => {
    // The covering read serves ~200–446; sixteen big reads of other files then push it
    // out of the working context (the chat #101 shape), and the request for 251–300 is
    // answered from the cache.
    const OTHERS = 16;
    const executed: Array<{ path: string; offset: number }> = [];
    const handed: string[][] = [];
    let turn = 0;
    await startRun(3502, {
      resolvedSystemPrompt: 'sys',
      tools: TOOLS,
      runTool: readTool(executed),
      stream: async (opts) => {
        if (opts.tools === undefined) return { text: 'Compressed memory of the earlier reads.', toolCalls: [], finishReason: 'stop' };
        turn += 1;
        handed.push(opts.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)));
        if (turn === 1) return call(turn, { path: PRD, offset: 200 });
        if (turn <= OTHERS + 1) return call(turn, { path: `f${turn}.ts` });
        if (turn === OTHERS + 2) return call(turn, { path: PRD, offset: 251, limit: 50 });
        return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
      },
      persistence,
      userTurn: 'update the PRD',
    });
    // The PRD was read from disk once — the covered request was served from the cache.
    expect(executed.filter((e) => e.path === PRD).map((e) => e.offset)).toEqual([200]);
    const replay = handed.flat().find((m) => m.includes('Lines 251–300 of this file'));
    expect(replay).toBeDefined();
    const parsed = JSON.parse(replay!) as { content: string; offset: number };
    expect(parsed.offset).toBe(251);
    const lines = parsed.content.split('\n');
    expect(lines[0]).toMatch(/^line 251 /);
    expect(lines).toHaveLength(50);
  });
});
