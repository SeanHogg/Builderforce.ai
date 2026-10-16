/**
 * The image surfaces' agent loop (`container/agentImageLoop.mjs` — the shared kernel
 * with the image semantics on its hooks), driven the way the container and the Actions
 * runner drive it. The module is plain ESM shipped into the image as-is, so this is the
 * only place its behaviour is exercised before deploy.
 */
import { describe, expect, it, vi } from 'vitest';
import { runImageLoop } from '../../../container/agentImageLoop.mjs';

type Turn = Record<string, unknown>;
const call = (id: string, name: string, args: Record<string, unknown> = {}) =>
  ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

/** An `llm` op that answers from a script, one body per turn. */
function scripted(turns: Turn[]) {
  const seen: Array<Array<Record<string, unknown>>> = [];
  const llm = vi.fn(async (messages: Array<Record<string, unknown>>) => {
    seen.push(messages.map((m) => ({ ...m })));
    const next = turns.shift();
    if (!next) throw new Error('script exhausted');
    return next;
  });
  return { llm, seen };
}

describe('runImageLoop', () => {
  it('finishes on a bare answer and on the finish tool', async () => {
    const { llm } = scripted([
      { content: 'reading', toolCalls: [call('c1', 'read_file', { path: 'a.ts' })] },
      { content: '', toolCalls: [call('c2', 'finish', { summary: 'done it' })] },
    ]);
    const execTool = vi.fn(async () => ({ ok: true }));
    const outcome = await runImageLoop({ messages: [], llm, execTool, isCancelled: () => false });
    expect(outcome).toEqual({ output: 'done it', cancelled: false, crashed: null, paused: false });
    expect(execTool).toHaveBeenCalledWith('read_file', { path: 'a.ts' }, expect.objectContaining({ toolCallId: 'c1', toolCallIds: ['c1'] }));
  });

  it('has no step cap — a long healthy run is never cut off', async () => {
    const turns: Turn[] = Array.from({ length: 45 }, (_, i) => ({ content: '', toolCalls: [call(`c${i}`, 'read_file')] }));
    turns.push({ content: 'all done', toolCalls: [] });
    const { llm } = scripted(turns);
    const outcome = await runImageLoop({ messages: [], llm, execTool: async () => ({ ok: true }), isCancelled: () => false });
    expect(llm).toHaveBeenCalledTimes(46);
    expect(outcome.output).toBe('all done');
  });

  it('stops on the failure-streak breaker instead', async () => {
    const turns: Turn[] = Array.from({ length: 20 }, (_, i) => ({ content: '', toolCalls: [call(`c${i}`, 'run_command')] }));
    const { llm } = scripted(turns);
    await runImageLoop({ messages: [], llm, execTool: async () => ({ ok: false, error: 'boom' }), isCancelled: () => false });
    expect(llm.mock.calls.length).toBeLessThan(20);
  });

  it('keeps going when a bare answer arrives with a steer (a user follow-up or a stall re-prompt)', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const { llm, seen } = scripted([
      { content: "I'll look at the handler.", toolCalls: [], steering: ['Make the call now.'] },
      { content: 'Fixed it.', toolCalls: [] },
    ]);
    const outcome = await runImageLoop({ messages, llm, execTool: async () => ({ ok: true }), isCancelled: () => false });
    expect(outcome.output).toBe('Fixed it.');
    expect(seen[1]!.slice(-2)).toEqual([
      { role: 'assistant', content: "I'll look at the handler." },
      { role: 'user', content: 'Make the call now.' },
    ]);
  });

  it('lets a steer override a finish in the same turn', async () => {
    const { llm, seen } = scripted([
      { content: '', toolCalls: [call('c1', 'finish', { summary: 'done' })], steering: ['also add tests'] },
      { content: 'tests added', toolCalls: [] },
    ]);
    const outcome = await runImageLoop({ messages: [], llm, execTool: async () => ({ ok: true }), isCancelled: () => false });
    expect(outcome.output).toBe('tests added');
    expect(seen[1]!.at(-1)).toEqual({ role: 'user', content: 'also add tests' });
  });

  it('parks on a paused tool result without running the rest of the turn', async () => {
    const { llm } = scripted([
      { content: '', toolCalls: [call('c1', 'ask_human', { question: 'Which?' }), call('c2', 'write_file')] },
    ]);
    const execTool = vi.fn(async (name: string) => (name === 'ask_human' ? { ok: true, paused: true } : { ok: true }));
    const outcome = await runImageLoop({ messages: [], llm, execTool, isCancelled: () => false });
    expect(outcome.paused).toBe(true);
    expect(execTool).toHaveBeenCalledTimes(1);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('adopts the history the Worker compacted', async () => {
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: 'long history' }];
    const compacted = [{ role: 'system', content: 'summary' }];
    const { llm, seen } = scripted([
      { content: '', toolCalls: [call('c1', 'read_file')], compactedMessages: compacted },
      { content: 'done', toolCalls: [] },
    ]);
    await runImageLoop({ messages, llm, execTool: async () => ({ ok: true }), isCancelled: () => false });
    expect(seen[1]![0]).toEqual({ role: 'system', content: 'summary' });
  });

  it('reports a gateway error as a crash and a cancelled turn as a cancel, keeping the last output', async () => {
    const crash = await runImageLoop({ messages: [], llm: async () => ({ error: '429 everywhere' }), execTool: async () => ({}), isCancelled: () => false });
    expect(crash.crashed).toBe('gateway error: 429 everywhere');

    const { llm } = scripted([
      { content: 'half way', toolCalls: [call('c1', 'read_file')] },
      { cancelled: true },
    ]);
    const cancel = await runImageLoop({ messages: [], llm, execTool: async () => ({ ok: true }), isCancelled: () => false });
    expect(cancel).toMatchObject({ cancelled: true, crashed: null, output: 'half way' });
  });

  it('stops before the next paid call once the heartbeat saw a cancel', async () => {
    let cancelled = false;
    const { llm } = scripted([{ content: '', toolCalls: [call('c1', 'run_command')] }, { content: 'never', toolCalls: [] }]);
    const outcome = await runImageLoop({
      messages: [], llm,
      execTool: async () => { cancelled = true; return { ok: true }; },
      isCancelled: () => cancelled,
    });
    expect(outcome.cancelled).toBe(true);
    expect(llm).toHaveBeenCalledTimes(1);
  });
});
