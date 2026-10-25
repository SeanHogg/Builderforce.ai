import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRunTrace, resetBrainRunStore, startRun } from '../brainRunStore';

/**
 * PRD 35 E2 ↔ E1: the host's task context pack ALWAYS rides the volatile per-turn block
 * (never the cached system prefix, whatever the stable-prefix lever says), and the files
 * it served whole are this run's reads already — a `read_file` of one is not run again.
 */
beforeEach(resetBrainRunStore);

const persistence = {
  sendMessages: async (chatId: number, msgs: Array<{ role: string; content: string }>) => msgs.map((m, i) => ({ id: 8800 + i, chatId, createdAt: '', ...m })),
} as never;
const TOOLS = [{ type: 'function' as const, function: { name: 'read_file', description: 'read', parameters: {} } }];
const textOf = (content: unknown): string => (typeof content === 'string' ? content : JSON.stringify(content ?? ''));

describe('the host task context', () => {
  it('rides after the history, never in the system prompt', async () => {
    let system = '';
    let user = '';
    await startRun(4801, {
      resolvedSystemPrompt: 'sys',
      persistence,
      userTurn: 'update docs/a.md',
      turnContext: async () => '## Task context pack\nPACK-BLOCK',
      stream: async (opts) => {
        system = opts.messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n');
        user = opts.messages.filter((m) => m.role === 'user').map((m) => textOf(m.content)).join('\n');
        return { text: 'ok', toolCalls: [], finishReason: 'stop' };
      },
    });
    expect(system).not.toContain('PACK-BLOCK');
    expect(user).toContain('PACK-BLOCK');
  });

  it('a file the pack served whole is not read again', async () => {
    const runTool = vi.fn(async () => ({ ok: true, path: 'docs/a.md', content: 'one\ntwo', totalLines: 2, offset: 1 }));
    let turn = 0;
    let replyToRead = '';
    await startRun(4802, {
      resolvedSystemPrompt: 'sys',
      persistence,
      tools: TOOLS,
      runTool,
      userTurn: 'update docs/a.md',
      turnContext: async () => '### Focus file `docs/a.md` (2 lines, whole file)\none\ntwo',
      servedReads: async () => [{ path: 'docs/a.md', content: 'one\ntwo', totalLines: 2 }],
      stream: async (opts) => {
        turn += 1;
        if (turn === 1) return { text: '', toolCalls: [{ id: 'r1', name: 'read_file', args: JSON.stringify({ path: 'docs/a.md' }) }], finishReason: 'tool_calls' };
        replyToRead = opts.messages.filter((m) => m.role === 'tool').map((m) => textOf(m.content)).join('\n');
        return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
      },
    });
    expect(runTool).not.toHaveBeenCalled();
    expect(replyToRead.length).toBeGreaterThan(0);
  });

  it('a host part that throws costs that part, and says so on the trace', async () => {
    await startRun(4803, {
      resolvedSystemPrompt: 'sys',
      persistence,
      userTurn: 'go',
      turnContext: async () => { throw new Error('pack offline'); },
      stream: async () => ({ text: 'ok', toolCalls: [], finishReason: 'stop' }),
    });
    const failed = getRunTrace(4803).find((e) => e.label === 'host.context_failed');
    expect(String(failed?.result)).toContain('pack offline');
  });
});
