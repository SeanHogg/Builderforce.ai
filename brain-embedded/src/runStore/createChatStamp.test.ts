/**
 * A work item the model creates is linked to this chat BY the create call: the run stamps
 * its server chat onto the server create tool (overriding whatever the model sent, and
 * stripping it for an unbound local chat) and the server links it. There is no second
 * `builtin_chats_link_ticket` call to fail or be skipped.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getRunTrace, resetBrainRunStore, startRun, type BrainStreamFn } from '../brainRunStore';
import type { RunLineage } from '../runLineage';

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
  return runWith(chatId, serverChatId);
}

/** {@link run}, optionally as a sub-agent of `lineage`'s owner. */
async function runWith(chatId: number, serverChatId: number | null | undefined, lineage?: RunLineage) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  await startRun(chatId, {
    ...(lineage ? { lineage } : {}),
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

  it("a sub-agent (lineage) run stamps its OWNER's server chat — the chat the whole tree lives in", async () => {
    const lineage: RunLineage = { rootChatId: 4800, ownerKey: 4800, ownerName: 'BuilderForce', handle: 'a1', label: 'file it', agent: { ref: 'agent_ada', name: 'Ada' }, depth: 1 };
    const calls = await runWith(-9001, undefined, lineage);
    expect(calls.find((c) => c.name === 'builtin_tasks_create')?.args.chatId).toBe(4800);
  });

  it("regression: a sub-agent run the editor host starts (own negative key, the root's bound server chat) stamps the PARENT chat on its create", async () => {
    // The VS Code host binds the ROOT local chat (4800) and passes its server chat (217);
    // the child's own key never names a chat.
    const lineage: RunLineage = { rootChatId: 4800, ownerKey: 4800, ownerName: 'BuilderForce', handle: 'a2', label: 'file it', agent: { ref: 'subagent:file it', name: 'file it' }, depth: 1 };
    const calls = await runWith(-9002, 217, lineage);
    expect(calls.find((c) => c.name === 'builtin_tasks_create')?.args.chatId).toBe(217);
  });

  it('strips a model-sent chatId for an unbound local chat', async () => {
    const calls = await run(6, null);
    const create = calls.find((c) => c.name === 'builtin_tasks_create');
    expect(create).toBeDefined();
    expect(create?.args).not.toHaveProperty('chatId');
    expect(calls.some((c) => c.name === 'builtin_chats_link_ticket')).toBe(false);
  });
});

/**
 * The planner's hand-off files its tickets through the run's runTool directly (not the
 * model dispatch), so it stamps too — and a create the server linked is recorded work,
 * which keeps the settle-time from_delta backstop from minting a second ticket.
 */
describe('hand-off tickets carry the chat and count as recorded work', () => {
  const PLAN = {
    summary: 'Two slices.',
    tasks: [
      { title: 'Slice A', brief: 'Do A.', paths: ['a.ts'] },
      { title: 'Slice B', brief: 'Do B.', paths: ['b.ts'] },
    ],
  };

  async function handOff(linked: boolean) {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let nextId = 900;
    let turn = 0;
    await startRun(5, {
      resolvedSystemPrompt: 'sys',
      tools: [spec('read_file'), spec('edit_file'), spec('builtin_tasks_create'), spec('spawn_agents')],
      projectId: 11,
      serverChatId: 4242,
      runTool: async (name, args) => {
        calls.push({ name, args: { ...(args as Record<string, unknown>) } });
        if (name === 'builtin_tasks_create') {
          const chatId = (args as { chatId?: number }).chatId;
          return { id: (nextId += 1), ...(linked ? { chatLink: { linked: true, chatId, linkType: 'created' } } : { chatLink: { linked: false, chatId, reason: 'Chat not found' } }) };
        }
        if (name === 'spawn_agents') return { ok: true, workstreams: [{ ok: true, label: 'a' }, { ok: true, label: 'b' }], changedFiles: ['a.ts', 'b.ts'] };
        return { ok: true, taskId: 990 };
      },
      stream: async () => {
        turn += 1;
        if (turn === 1) return { text: 'Planned.', toolCalls: [{ id: 'h1', name: 'hand_off', args: JSON.stringify(PLAN) }], finishReason: 'tool_calls' };
        return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
      },
      persistence,
      userTurn: 'do the two slices',
      chatMode: 'work',
    });
    return calls;
  }

  it("stamps the run's chat onto every hand-off create, and a linked create keeps the from_delta backstop quiet", async () => {
    const calls = await handOff(true);
    expect(calls.filter((c) => c.name === 'builtin_tasks_create').map((c) => c.args.chatId)).toEqual([4242, 4242]);
    expect(calls.some((c) => c.name === 'builtin_chats_link_ticket')).toBe(false);
    expect(calls.some((c) => c.name === 'builtin_tickets_from_delta')).toBe(false);
  });

  it('a hand-off create the server could NOT link is not recorded work, so the backstop still records the change', async () => {
    const calls = await handOff(false);
    expect(calls.some((c) => c.name === 'builtin_tickets_from_delta')).toBe(true);
  });
});
