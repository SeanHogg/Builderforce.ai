/**
 * A work item the model creates is linked to this chat BY the create call: the run stamps
 * its server chat onto the server create tool (overriding whatever the model sent, and
 * stripping it for an unbound local chat) and the server links it. There is no second
 * `builtin_chats_link_ticket` call to fail or be skipped.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getRunTrace, resetBrainRunStore, startRun, type BrainStreamFn } from '../brainRunStore';

beforeEach(resetBrainRunStore);

const spec = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: {} } });

const persistence = {
  sendMessages: async (_chatId: number, msgs: Array<{ role: string; content: string; metadata?: string }>) =>
    msgs.map((m, i) => ({ id: 900 + i, seq: i + 1, createdAt: '', metadata: m.metadata ?? null, role: m.role, content: m.content })),
} as never;

/** One model turn that creates a ticket (sending its own guessed chat), then a final answer. */
function createThenStop(): BrainStreamFn {
  let turn = 0;
  return async () => {
    turn += 1;
    if (turn === 1) {
      return {
        text: '',
        toolCalls: [{ id: 'c1', name: 'builtin_tasks_create', args: JSON.stringify({ projectId: 3, title: 'Fix login', chatId: 999 }) }],
        finishReason: 'tool_calls',
      };
    }
    return { text: 'Filed it.', toolCalls: [], finishReason: 'stop' };
  };
}

async function run(chatId: number, serverChatId: number | null | undefined) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  await startRun(chatId, {
    resolvedSystemPrompt: 'sys',
    tools: [spec('builtin_tasks_create'), spec('builtin_chats_link_ticket')],
    projectId: 3,
    runTool: async (name, args) => {
      calls.push({ name, args: { ...(args as Record<string, unknown>) } });
      if (name === 'builtin_tasks_create') {
        const stamped = (args as { chatId?: number }).chatId;
        return { id: 41, title: 'Fix login', ...(stamped != null ? { chatLink: { linked: true, chatId: stamped, linkType: 'created' } } : {}) };
      }
      return { ok: true };
    },
    stream: createThenStop(),
    persistence,
    userTurn: 'file a ticket for the login bug',
    ...(serverChatId !== undefined ? { serverChatId } : {}),
    chatMode: 'work',
  });
  return calls;
}

describe("a model's create call carries the run's chat", () => {
  it("stamps the run's serverChatId, overriding the model's own chatId, and fires no separate link", async () => {
    const calls = await run(5, 4242);
    const create = calls.find((c) => c.name === 'builtin_tasks_create');
    expect(create?.args.chatId).toBe(4242);
    expect(calls.some((c) => c.name === 'builtin_chats_link_ticket')).toBe(false);
    // The create's own trace step carries the server's link verdict.
    const step = getRunTrace(5).find((e) => e.label === 'builtin_tasks_create');
    expect(step?.result).toMatchObject({ chatLink: { linked: true, chatId: 4242 } });
  });

  it('strips a model-sent chatId for an unbound local chat', async () => {
    const calls = await run(6, null);
    const create = calls.find((c) => c.name === 'builtin_tasks_create');
    expect(create).toBeDefined();
    expect(create?.args).not.toHaveProperty('chatId');
    expect(calls.some((c) => c.name === 'builtin_chats_link_ticket')).toBe(false);
  });
});
