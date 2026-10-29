/**
 * agentReplyRun — the @-reply as the cloud adapter's second caller of the one agent (PRD 35 WS3). The REAL agent runs;
 * fakes sit only at the gateway (`completeTraced` / `readProxyChoice`), the platform-tool catalog and the memory tail.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ASK_USER_TOOL, ASK_USER_TOOL_SPEC } from '@builderforce/agent-loop';

const h = vi.hoisted(() => ({
  script: [] as Array<{ content: string; toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> }>,
  turn: 0,
  requests: [] as Array<Record<string, unknown>>,
  callTool: vi.fn(async (..._a: unknown[]) => ({ tasks: [] })),
}));
vi.mock('./brainLlmCall', () => ({
  completeTraced: async (_db: unknown, _service: unknown, body: Record<string, unknown>) => {
    h.requests.push(body);
    return { resolvedModel: 'reply-model', resolvedVendor: 'v', byoFunded: false, response: { status: 200 }, script: h.script[Math.min(h.turn++, h.script.length - 1)] };
  },
}));
vi.mock('../llm/LlmProxyService', () => ({
  readProxyChoice: async (r: { script: { content: string; toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> } }) => ({
    message: null, finishReason: 'stop', content: r.script.content,
    toolCalls: (r.script.toolCalls ?? []).map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
  }),
}));
vi.mock('../llm/builtinMcpService', () => ({ callBuiltinTool: h.callTool }));
vi.mock('../llm/codingFallbackSurface', () => ({ codingFallbackSurface: () => null }));
vi.mock('../llm/gatewaySummarizer', () => ({ buildGatewaySummarizer: () => async () => null }));
vi.mock('../runtime/cloudAgent/routing', () => ({ requestedModelForRole: () => undefined }));
vi.mock('../runtime/cloudAgent/runEndMemory', () => ({
  applyVerifyPhase: (p: unknown) => p, commitRunMemory: vi.fn(async () => true), describeVerifyOutcome: () => 'note',
  recordRunVerifyEvents: vi.fn(), runVerifyPhase: () => ({ kind: 'skipped', surface: 'brain-reply', commands: [], failedCommands: [], mayFinish: true }),
}));

import { runAgentReply, type AgentReplyRunInput } from './agentReplyRun';

const TOOL = 'builtin_tasks_list';
const input = (): AgentReplyRunInput => ({
  db: {} as never, env: {} as never, tenantId: 1, userId: 'u1', chatId: 9, agentRef: 'ref-7', agentName: 'Ada',
  service: {} as never,
  convo: [{ role: 'system', content: 'You are Ada.' }, { role: 'user', content: 'Conversation so far:\n\nUser: list my tasks' }],
  toolset: {
    tools: [{ type: 'function', function: { name: TOOL, description: 'list', parameters: { type: 'object', properties: {} } } }, ASK_USER_TOOL_SPEC],
    nameToTool: new Map([[TOOL, 'tasks.list']]), nameFor: () => TOOL,
  } as never,
  userRequest: 'list my tasks', replyTemp: 0.4, pinnedModel: undefined, byoVendors: new Set<string>(),
  plan: { effectivePlan: 'free', premiumOverride: false }, call: {} as never,
});

beforeEach(() => { vi.clearAllMocks(); h.turn = 0; h.requests.length = 0; });

describe('runAgentReply', () => {
  it('runs a platform tool as the user, then replies; the trace names the catalog id and the model turns', async () => {
    h.script = [{ content: '', toolCalls: [{ id: 't1', name: TOOL, args: { limit: 3 } }] }, { content: 'You have no tasks.' }];
    const s = await runAgentReply(input());
    expect(s.text).toBe('You have no tasks.');
    expect(h.callTool.mock.calls[0]?.[1]).toMatchObject({ tenantId: 1, tool: 'tasks.list', arguments: { limit: 3 }, userId: 'u1', agentRef: 'ref-7' });
    expect(s.toolCallCount).toBe(1);
    expect(s.lastModel).toBe('reply-model');
    expect(s.trace.map((r) => r.category)).toEqual(['llm', 'tool', 'llm']);
    expect(s.trace[1]).toMatchObject({ label: 'tasks.list', args: { limit: 3 }, isError: false });
    // The persona is the system row, the conversation the first user row; the tail follows.
    const first = h.requests[0]?.messages as Array<{ role: string; content: string }>;
    expect(first[0]).toEqual({ role: 'system', content: 'You are Ada.' });
    expect(first[1]?.content).toContain('list my tasks');
  });

  it('ask_user ends the reply with the lead-in prose and the card, and its sibling calls never run', async () => {
    h.script = [{
      content: 'One quick thing.',
      toolCalls: [
        { id: 'a1', name: ASK_USER_TOOL, args: { question: 'Which board?', options: [{ label: 'Alpha' }, { label: 'Beta' }] } },
        { id: 'a2', name: TOOL, args: {} },
      ],
    }];
    const s = await runAgentReply(input());
    expect(s.text.startsWith('One quick thing.')).toBe(true);
    expect(s.text).toContain('ask-user');
    expect(h.callTool).not.toHaveBeenCalled();
  });

  it('a malformed ask_user that came with prose settles on the prose', async () => {
    h.script = [{ content: 'Which board did you mean?', toolCalls: [{ id: 'a1', name: ASK_USER_TOOL, args: { question: 'x' } }] }];
    expect((await runAgentReply(input())).text).toBe('Which board did you mean?');
  });
});
