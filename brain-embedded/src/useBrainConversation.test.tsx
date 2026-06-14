import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { useBrainConversation } from './useBrainConversation';
import { streamChatCompletion, type StreamChatResult } from './streamChatCompletion';
import { BrainProvider, type BrainConfig, type BrainPersistenceAdapter } from './config';

// --- Mocks -----------------------------------------------------------------

// BrainProvider builds its `stream` from this module fn, so mocking it here
// lets us drive the agent loop deterministically through the injection seam.
vi.mock('./streamChatCompletion', () => ({
  streamChatCompletion: vi.fn(),
}));

let seq = 0;
const persistence = {
  getMessages: vi.fn(async () => []),
  // Echo each sent message back with a fresh id, as the real API does.
  sendMessages: vi.fn(async (_chatId: number, msgs: Array<{ role: string; content: string; metadata?: string }>) =>
    msgs.map((m) => ({ id: ++seq, role: m.role, content: m.content, metadata: m.metadata ?? null, seq, createdAt: '' })),
  ),
  setMessageFeedback: vi.fn(async () => ({ ok: true })),
  upload: vi.fn(),
  uploadUrl: (key: string) => `https://x/${key}`,
} as unknown as BrainPersistenceAdapter;

const config: BrainConfig = {
  transport: { baseUrl: 'https://gw.example', getToken: () => null },
  persistence,
  resolveSystemPrompt: () => 'You are Brain.',
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <BrainProvider config={config}>{children}</BrainProvider>
);

const mockStream = vi.mocked(streamChatCompletion);

function result(partial: Partial<StreamChatResult>): StreamChatResult {
  return { text: '', toolCalls: [], finishReason: 'stop', ...partial };
}

const TOOL = {
  type: 'function' as const,
  function: { name: 'do_thing', description: '', parameters: { type: 'object' } },
};

beforeEach(() => {
  seq = 0;
  mockStream.mockReset();
  vi.mocked(persistence.sendMessages).mockClear();
});

describe('useBrainConversation agent loop (injected transport + persistence)', () => {
  it('text-only reply: persists user + final assistant once, no tools', async () => {
    mockStream.mockResolvedValueOnce(result({ text: 'hello there' }));
    const { rerender, result: hook } = renderHook(
      (props: { chatId: number }) =>
        useBrainConversation({ chatId: props.chatId, toolSpecs: [], runTool: vi.fn() }),
      { initialProps: { chatId: 1 }, wrapper },
    );
    rerender({ chatId: 1 });

    await act(async () => { await hook.current.send('hi'); });

    expect(mockStream).toHaveBeenCalledTimes(1);
    // user + assistant persisted
    expect(persistence.sendMessages).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(hook.current.messages.map((m) => m.content)).toEqual(['hi', 'hello there']);
    });
  });

  it('tool call round-trips: runs the tool, feeds the result back, then finalizes', async () => {
    mockStream
      .mockResolvedValueOnce(result({ text: '', toolCalls: [{ id: 'c1', name: 'do_thing', args: '{"x":1}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ text: 'done' }));
    const runTool = vi.fn(async () => ({ ok: true }));

    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 1, toolSpecs: [TOOL], runTool }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('go'); });

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith('do_thing', { x: 1 });
    expect(mockStream).toHaveBeenCalledTimes(2);

    // Second model call must include the assistant tool-call turn + the tool result.
    const secondCallMessages = mockStream.mock.calls[1][0].messages;
    expect(secondCallMessages.some((m) => m.role === 'assistant' && m.tool_calls?.length)).toBe(true);
    const toolMsg = secondCallMessages.find((m) => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe('c1');
    expect(toolMsg?.content).toContain('"ok":true');

    // Only user + final assistant persisted (tool turns stay in-memory).
    expect(persistence.sendMessages).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(hook.current.messages.map((m) => m.content)).toEqual(['go', 'done']);
    });
  });

  it('carries prior-turn tool calls + results into the next turn (cross-turn grounding)', async () => {
    // Turn 1: model resolves an entity via a tool, then answers.
    mockStream
      .mockResolvedValueOnce(result({ text: '', toolCalls: [{ id: 't1', name: 'do_thing', args: '{"company":"A"}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ text: 'Updated A (id=123).' }))
      // Turn 2: a fresh request in the same chat.
      .mockResolvedValueOnce(result({ text: 'Updated B.' }));
    const runTool = vi.fn(async () => ({ id: 123, name: 'A', url: 'a.com' }));

    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 1, toolSpecs: [TOOL], runTool }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('update A url'); });
    await act(async () => { await hook.current.send('update another url'); });

    // The turn-2 model call must still see turn-1's tool call + result + the
    // assistant text — the grounding that was previously dropped between turns.
    const turn2Messages = mockStream.mock.calls[2][0].messages;
    const roles = turn2Messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
    const toolMsg = turn2Messages.find((m) => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe('t1');
    expect(toolMsg?.content).toContain('"id":123');
    // Both user turns are present and distinct (no clobbering).
    expect(turn2Messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'update A url',
      'update another url',
    ]);
  });

  it('honours the max-iteration cap when the model never stops calling tools', async () => {
    mockStream.mockResolvedValue(
      result({ toolCalls: [{ id: 'c', name: 'do_thing', args: '{}' }], finishReason: 'tool_calls' }),
    );
    const runTool = vi.fn(async () => ({ ok: true }));
    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 1, toolSpecs: [TOOL], runTool }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('loop'); });

    // Runs up to the max-iteration cap, then it gives up.
    expect(mockStream).toHaveBeenCalledTimes(25);
    expect(runTool).toHaveBeenCalledTimes(25);
    // user persisted, but no final assistant text.
    expect(persistence.sendMessages).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(hook.current.error).toMatch(/kept calling tools/i));
  });

  it('captures a thrown tool error: feeds it back, records it, and surfaces it in the triage report', async () => {
    mockStream
      .mockResolvedValueOnce(result({ text: 'trying', toolCalls: [{ id: 'c1', name: 'do_thing', args: '{}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ text: 'recovered' }));
    const runTool = vi.fn(async () => { throw new Error('no repo bound'); });

    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 7, toolSpecs: [TOOL], runTool }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('go'); });

    // The throw is fed back as a recoverable tool result (loop continues, not aborts).
    expect(mockStream).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockStream.mock.calls[1][0].messages;
    const toolMsg = secondCallMessages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('"ok":false');
    expect(toolMsg?.content).toContain('no repo bound');
    await waitFor(() => expect(hook.current.messages.map((m) => m.content)).toEqual(['go', 'recovered']));

    // The execution is captured: the report counts the error and names the tool.
    expect(hook.current.hasTrace).toBe(true);
    const report = hook.current.buildTriageReport('Brain (default)');
    expect(report).toContain('=== BuilderForce Brain Triage ===');
    expect(report).toContain('--- Errors (1) ---');
    expect(report).toContain('do_thing');
    expect(report).toContain('no repo bound');
    // LLM steps + intermediate assistant message are in the trace too.
    expect(report).toContain('llm.complete');
    expect(report).toContain('agent.message');
  });
});
