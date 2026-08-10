import { beforeEach, describe, expect, it, vi } from 'vitest';

const brainMock = vi.hoisted(() => ({
  createChat: vi.fn(), listChatAgents: vi.fn(), inviteChatAgent: vi.fn(), sendMessages: vi.fn(), requestAgentReply: vi.fn(),
}));
vi.mock('./builderforceApi', () => ({ brain: brainMock }));

import { addressedCanvasAgents, runCanonicalCanvasGroupTurn } from './creationAgentChat';

const agents = [{ ref: 'researcher', name: 'Market Researcher' }, { ref: 'designer', name: 'Product Designer' }];

describe('Canvas agent addressing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    brainMock.createChat.mockResolvedValue({ id: 42 });
    brainMock.listChatAgents.mockResolvedValue([]);
    brainMock.inviteChatAgent.mockResolvedValue({});
    brainMock.sendMessages.mockResolvedValue([]);
    brainMock.requestAgentReply.mockImplementation(async (_chatId: number, input: { agentRef: string; agentName: string }) => ({ id: input.agentRef === 'researcher' ? 1 : 2, seq: 1, role: 'assistant', content: `${input.agentName} answer`, metadata: JSON.stringify({ authoredBy: { kind: 'agent', ref: input.agentRef, name: input.agentName } }), createdAt: '2026-08-04T00:00:00.000Z' }));
  });
  it('routes an @mention to one canonical participant', () => {
    expect(addressedCanvasAgents('Ask @ProductDesigner to draft it', agents).map((agent) => agent.ref)).toEqual(['designer']);
  });

  it('routes ask-all and unaddressed group turns to every participant', () => {
    expect(addressedCanvasAgents('Ask all to challenge this idea', agents)).toEqual(agents);
    expect(addressedCanvasAgents('Discuss the tradeoffs', agents)).toEqual(agents);
  });

  it('creates a durable chat, invites canonical agents, persists the prompt, and collects attributed replies', async () => {
    const result = await runCanonicalCanvasGroupTurn({ title: 'Launch', sessionId: 'session-1', prompt: 'Ask all', agents });
    expect(result.chatId).toBe(42);
    expect(brainMock.inviteChatAgent).toHaveBeenCalledTimes(2);
    expect(brainMock.sendMessages).toHaveBeenCalledWith(42, [expect.objectContaining({ role: 'user', content: 'Ask all' })]);
    expect(brainMock.requestAgentReply).toHaveBeenCalledTimes(2);
    expect(result.contributions.map((item) => item.agent.ref)).toEqual(['researcher', 'designer']);
  });

  it('reuses an existing chat and only runs the mentioned participant', async () => {
    brainMock.listChatAgents.mockResolvedValue([{ agentRef: 'designer' }]);
    const result = await runCanonicalCanvasGroupTurn({ chatId: 9, title: 'Launch', sessionId: 'session-1', prompt: '@ProductDesigner refine it', agents });
    expect(brainMock.createChat).not.toHaveBeenCalled();
    expect(brainMock.inviteChatAgent).toHaveBeenCalledTimes(1);
    expect(brainMock.requestAgentReply).toHaveBeenCalledTimes(1);
    expect(result.contributions[0]!.agent.ref).toBe('designer');
  });
});
