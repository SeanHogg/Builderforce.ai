import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  ensureGuestToken: vi.fn(async () => true),
}));

vi.mock('@seanhogg/builderforce-brain-embedded', () => ({
  fetchMcpToolEntries: vi.fn(async () => []),
  mcpActionsFrom: vi.fn(() => []),
  streamChatCompletion: mocks.streamChatCompletion,
}));
vi.mock('@/lib/brain/runtime', () => ({ brainConfig: { transport: {} } }));
vi.mock('@/lib/brain/guestRuntime', () => ({ guestBrainConfig: { transport: {} } }));
vi.mock('@/lib/guestChatApi', () => ({ ensureGuestToken: mocks.ensureGuestToken }));

const { runCreationCanvasAi } = await import('./creationCanvasAi');

describe('runCreationCanvasAi', () => {
  beforeEach(() => {
    mocks.streamChatCompletion.mockReset();
    mocks.ensureGuestToken.mockResolvedValue(true);
  });

  it('executes a guest canvas tool call and distinguishes LLM from Evermind', async () => {
    const run = vi.fn(() => ({ ok: true, proposed: true }));
    mocks.streamChatCompletion
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'call-1', name: 'canvas_add_object', args: JSON.stringify({ kind: 'llm', title: 'New LLM' }) }],
      })
      .mockResolvedValueOnce({ text: 'I proposed a new LLM for review.', toolCalls: [] });

    const answer = await runCreationCanvasAi({
      prompt: 'build a new LLM',
      canvasSnapshot: '{"objects":[]}',
      persistence: 'local',
      canvasActions: [{
        name: 'canvas_add_object',
        description: 'Add an object',
        parameters: { type: 'object' },
        mutates: true,
        run,
      }],
    });

    expect(run).toHaveBeenCalledWith({ kind: 'llm', title: 'New LLM' });
    expect(answer).toBe('I proposed a new LLM for review.');
    const firstRequest = mocks.streamChatCompletion.mock.calls[0][0];
    expect(firstRequest.tools).toHaveLength(1);
    expect(firstRequest.messages[0].content).toContain('kind "llm" is a conventional language-model blueprint');
    expect(firstRequest.messages[0].content).toContain('kind "evermind" is BuilderForce\'s self-learning Evermind model');
    expect(firstRequest.messages[0].content).toContain('"create a workflow" means call canvas_add_object');
    expect(firstRequest.messages[0].content).toContain('do not call builtin_workflows_create or ask a follow-up question');
    expect(firstRequest.messages[0].content).toContain('call canvas_arrange_objects');
    expect(firstRequest.messages[0].content).toContain('Never emit tool_code');
  });
});
