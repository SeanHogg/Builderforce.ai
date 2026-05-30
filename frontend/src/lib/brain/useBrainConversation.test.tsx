import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBrainConversation } from './useBrainConversation';
import { streamChatCompletion, type StreamChatResult } from './streamChatCompletion';
import { brain } from '../builderforceApi';

// --- Mocks -----------------------------------------------------------------

vi.mock('./streamChatCompletion', () => ({
  streamChatCompletion: vi.fn(),
}));

let seq = 0;
vi.mock('../builderforceApi', () => ({
  brain: {
    getMessages: vi.fn(async () => []),
    // Echo each sent message back with a fresh id, as the real API does.
    sendMessages: vi.fn(async (_chatId: number, msgs: Array<{ role: string; content: string; metadata?: string }>) =>
      msgs.map((m) => ({ id: ++seq, role: m.role, content: m.content, metadata: m.metadata ?? null, seq, createdAt: '' })),
    ),
    setMessageFeedback: vi.fn(async () => ({ ok: true })),
    upload: vi.fn(),
    uploadUrl: (key: string) => `https://x/${key}`,
  },
}));

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
  vi.mocked(brain.sendMessages).mockClear();
});

describe('useBrainConversation agent loop', () => {
  it('text-only reply: persists user + final assistant once, no tools', async () => {
    mockStream.mockResolvedValueOnce(result({ text: 'hello there' }));
    const { rerender, result: hook } = renderHook((props: { chatId: number }) =>
      useBrainConversation({ chatId: props.chatId, toolSpecs: [], runTool: vi.fn() }),
      { initialProps: { chatId: 1 } },
    );
    rerender({ chatId: 1 });

    await act(async () => { await hook.current.send('hi'); });

    expect(mockStream).toHaveBeenCalledTimes(1);
    // user + assistant persisted
    expect(brain.sendMessages).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(hook.current.messages.map((m) => m.content)).toEqual(['hi', 'hello there']);
    });
  });

  it('tool call round-trips: runs the tool, feeds the result back, then finalizes', async () => {
    mockStream
      .mockResolvedValueOnce(result({ text: '', toolCalls: [{ id: 'c1', name: 'do_thing', args: '{"x":1}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ text: 'done' }));
    const runTool = vi.fn(async () => ({ ok: true }));

    const { result: hook } = renderHook(() =>
      useBrainConversation({ chatId: 1, toolSpecs: [TOOL], runTool }),
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
    expect(brain.sendMessages).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(hook.current.messages.map((m) => m.content)).toEqual(['go', 'done']);
    });
  });

  it('honours the max-iteration cap when the model never stops calling tools', async () => {
    mockStream.mockResolvedValue(
      result({ toolCalls: [{ id: 'c', name: 'do_thing', args: '{}' }], finishReason: 'tool_calls' }),
    );
    const runTool = vi.fn(async () => ({ ok: true }));
    const { result: hook } = renderHook(() =>
      useBrainConversation({ chatId: 1, toolSpecs: [TOOL], runTool }),
    );

    await act(async () => { await hook.current.send('loop'); });

    // 5 iterations, then it gives up.
    expect(mockStream).toHaveBeenCalledTimes(5);
    expect(runTool).toHaveBeenCalledTimes(5);
    // user persisted, but no final assistant text.
    expect(brain.sendMessages).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(hook.current.error).toMatch(/kept calling tools/i));
  });
});
