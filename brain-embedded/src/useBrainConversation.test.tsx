import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { useBrainConversation } from './useBrainConversation';
import { resetBrainRunStore } from './brainRunStore';
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
  subscribeMessages: vi.fn(() => () => {}),
  // Echo each sent message back with a fresh id, as the real API does.
  sendMessages: vi.fn(async (_chatId: number, msgs: Array<{ role: string; content: string; metadata?: string }>) =>
    msgs.map((m) => ({ id: ++seq, role: m.role, content: m.content, metadata: m.metadata ?? null, seq, createdAt: '' })),
  ),
  setMessageFeedback: vi.fn(async () => ({ ok: true })),
  markChatRead: vi.fn(async () => ({ lastReadSeq: 0 })),
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
  vi.mocked(persistence.getMessages).mockReset().mockResolvedValue([]);
  vi.mocked(persistence.subscribeMessages!).mockReset().mockImplementation(() => () => {});
  vi.mocked(persistence.markChatRead!).mockReset().mockResolvedValue({ lastReadSeq: 0 });
  // Reset, not just clear: a test that installs a persistent `mockImplementation`
  // (the learn-signal cases) would otherwise leak it into every test after it.
  vi.mocked(persistence.sendMessages).mockReset().mockImplementation(
    async (_chatId: number, msgs: Array<{ role: string; content: string; metadata?: string }>) =>
      msgs.map((m) => ({ id: ++seq, role: m.role, content: m.content, metadata: m.metadata ?? null, seq, createdAt: '' })),
  );
  // The run engine is a module-level singleton keyed by chatId; reset it so a
  // chat's session-lived transcript doesn't leak between tests reusing chatId 1.
  resetBrainRunStore();
});

describe('useBrainConversation agent loop (injected transport + persistence)', () => {
  it('streams durable messages appended by an assigned agent into the open chat', async () => {
    let notifyChanged: (() => void) | undefined;
    vi.mocked(persistence.subscribeMessages!).mockImplementation((_chatId, onChanged) => {
      notifyChanged = onChanged;
      return () => {};
    });
    const serverMessages: Array<{ id: number; role: string; content: string; metadata: string | null; seq: number; createdAt: string }> = [];
    vi.mocked(persistence.getMessages).mockImplementation(async () => [...serverMessages]);
    const { result: hook, unmount } = renderHook(
      () => useBrainConversation({ chatId: 41, toolSpecs: [], runTool: vi.fn() }),
      { wrapper },
    );

    await waitFor(() => expect(persistence.getMessages).toHaveBeenCalled());
    serverMessages.push({
      id: 9001,
      role: 'assistant',
      content: '▶️ **John Coder** started working on task #712.',
      metadata: JSON.stringify({ runMilestone: '88:started', agentRef: 'john-coder' }),
      seq: 1,
      createdAt: '2026-07-13T00:30:00.000Z',
    });
    act(() => notifyChanged?.());

    await waitFor(() => expect(hook.current.messages.map((m) => m.content)).toContain(
      '▶️ **John Coder** started working on task #712.',
    ));
    unmount();
  });

  it('marks the OPEN chat read up to its newest seq (clears the unread badge on view)', async () => {
    vi.mocked(persistence.getMessages).mockResolvedValue([
      { id: 5, role: 'assistant', content: 'a', metadata: null, seq: 5, createdAt: '' },
      { id: 9, role: 'assistant', content: '✅ finished', metadata: null, seq: 9, createdAt: '' },
    ]);
    const { unmount } = renderHook(
      () => useBrainConversation({ chatId: 41, toolSpecs: [], runTool: vi.fn() }),
      { wrapper },
    );
    await waitFor(() => expect(persistence.markChatRead).toHaveBeenCalledWith(41, 9));
    unmount();
  });

  it('advances the read mark forward when a later milestone arrives, but never rewinds', async () => {
    let notifyChanged: (() => void) | undefined;
    vi.mocked(persistence.subscribeMessages!).mockImplementation((_chatId, onChanged) => {
      notifyChanged = onChanged;
      return () => {};
    });
    const server = [{ id: 3, role: 'assistant', content: 'a', metadata: null, seq: 3, createdAt: '' }];
    vi.mocked(persistence.getMessages).mockImplementation(async () => [...server]);
    const { unmount } = renderHook(
      () => useBrainConversation({ chatId: 41, toolSpecs: [], runTool: vi.fn() }),
      { wrapper },
    );
    await waitFor(() => expect(persistence.markChatRead).toHaveBeenLastCalledWith(41, 3));

    // A new milestone lands (seq 7) → the mark advances to 7.
    server.push({ id: 7, role: 'assistant', content: '✅', metadata: null, seq: 7, createdAt: '' });
    act(() => notifyChanged?.());
    await waitFor(() => expect(persistence.markChatRead).toHaveBeenLastCalledWith(41, 7));

    // A redundant reload with no newer message must NOT re-mark (monotonic guard).
    const callsAt7 = vi.mocked(persistence.markChatRead!).mock.calls.length;
    act(() => notifyChanged?.());
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(persistence.markChatRead!).mock.calls.length).toBe(callsAt7);
    unmount();
  });

  it('does not mark read when there is no open chat', async () => {
    const { unmount } = renderHook(
      () => useBrainConversation({ chatId: null, toolSpecs: [], runTool: vi.fn() }),
      { wrapper },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(persistence.markChatRead).not.toHaveBeenCalled();
    unmount();
  });

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
    // user + the durable `llm` turn step + assistant persisted. Each LLM turn now
    // persists a compact diagnostics row (usage/finishReason — no transcript text)
    // so a chat copied after a reload can still report its turns and tokens.
    expect(persistence.sendMessages).toHaveBeenCalledTimes(3);
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

    // user + 2 durable `llm` turn steps + the durable tool STEP + final assistant
    // persist. Step rows (role:'tool') survive a reload but are NOT added to the live
    // message list (recordAppended) and are excluded from the model seed.
    expect(persistence.sendMessages).toHaveBeenCalledTimes(5);
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

  it('keeps each tool-call turn’s narration as its own block (no streaming-buffer erase)', async () => {
    // Two tool-call turns that each narrate, then a final answer. Regression for
    // the bug where the next turn's stream reused/erased the prior narration.
    mockStream
      .mockResolvedValueOnce(result({ text: 'Let me clean up the duplicate.', toolCalls: [{ id: 'a', name: 'do_thing', args: '{}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ text: 'Now linking the parent.', toolCalls: [{ id: 'b', name: 'do_thing', args: '{}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ text: 'All done.' }));
    const runTool = vi.fn(async () => ({ ok: true }));

    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 3, toolSpecs: [TOOL], runTool }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('fix the epic'); });

    // Every narrating turn is its own durable bubble — none erased by the next.
    await waitFor(() => {
      expect(hook.current.messages.map((m) => m.content)).toEqual([
        'fix the epic',
        'Let me clean up the duplicate.',
        'Now linking the parent.',
        'All done.',
      ]);
    });
    // user + 2 narrations + 2 durable tool steps + final answer.
    expect(persistence.sendMessages).toHaveBeenCalledTimes(9);
  });

  it('persists nothing extra for a pure tool-call turn with no text', async () => {
    mockStream
      .mockResolvedValueOnce(result({ text: '', toolCalls: [{ id: 'c1', name: 'do_thing', args: '{}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ text: 'done' }));
    const runTool = vi.fn(async () => ({ ok: true }));

    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 9, toolSpecs: [TOOL], runTool }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('go'); });

    // Empty narration ⇒ NO narration bubble; user + the durable tool step + final
    // assistant persist (the empty-text turn still records its tool step durably).
    expect(persistence.sendMessages).toHaveBeenCalledTimes(5);
    await waitFor(() => expect(hook.current.messages.map((m) => m.content)).toEqual(['go', 'done']));
  });

  it('errors only when the forced final answer is ALSO empty at the iteration cap', async () => {
    // The model calls a tool on every turn AND never produces prose — even the
    // forced no-tools closing turn (mockResolvedValue is unconditional) comes back
    // empty. Only then do we surface the loop-exhausted error.
    mockStream.mockResolvedValue(
      result({ toolCalls: [{ id: 'c', name: 'do_thing', args: '{}' }], finishReason: 'tool_calls' }),
    );
    const runTool = vi.fn(async () => ({ ok: true }));
    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 1, toolSpecs: [TOOL], runTool }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('loop'); });

    // 25 tool-loop turns + 1 forced final-synthesis turn (no tools) = 26 completions.
    expect(mockStream).toHaveBeenCalledTimes(26);
    // The forced closing turn runs no tools, so tool execution is unchanged at 25.
    expect(runTool).toHaveBeenCalledTimes(25);
    // user + 25 durable tool steps persist; no final assistant text (the forced
    // closing turn was empty too, so no answer bubble).
    expect(persistence.sendMessages).toHaveBeenCalledTimes(51);
    await waitFor(() => expect(hook.current.error).toMatch(/kept calling tools/i));
  });

  it('rescues a tool-budget-exhausted run with a forced final answer instead of erroring', async () => {
    // 25 turns that only call a tool, then the forced no-tools closing turn produces
    // prose — that answer is persisted and NO "kept calling tools" error surfaces.
    let call = 0;
    mockStream.mockImplementation(async () => {
      call += 1;
      return call <= 25
        ? result({ toolCalls: [{ id: `c${call}`, name: 'do_thing', args: '{}' }], finishReason: 'tool_calls' })
        : result({ text: 'Here is what I found so far, and what I could not finish.' });
    });
    const runTool = vi.fn(async () => ({ ok: true }));
    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 2, toolSpecs: [TOOL], runTool }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('loop'); });

    expect(mockStream).toHaveBeenCalledTimes(26); // 25 tool turns + forced final synthesis
    expect(runTool).toHaveBeenCalledTimes(25);
    expect(hook.current.error).toBeFalsy();
    // user + 25 durable tool steps + the forced final answer persist.
    expect(persistence.sendMessages).toHaveBeenCalledTimes(52);
    await waitFor(() =>
      expect(hook.current.messages.map((m) => m.content)).toEqual(['loop', 'Here is what I found so far, and what I could not finish.']),
    );
  });

  it('dedups an identical read_file call within a run (stubs the repeat, does not re-read)', async () => {
    mockStream
      .mockResolvedValueOnce(result({ toolCalls: [{ id: 'c1', name: 'read_file', args: '{"path":"a.ts"}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ toolCalls: [{ id: 'c2', name: 'read_file', args: '{"path":"a.ts"}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ text: 'done' }));
    const runTool = vi.fn(async () => ({ ok: true, content: 'file body' }));
    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 3, toolSpecs: [], runTool }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('read it twice'); });

    expect(mockStream).toHaveBeenCalledTimes(3);
    // The second identical read is suppressed — the tool ran only once.
    expect(runTool).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(hook.current.messages.map((m) => m.content)).toEqual(['read it twice', 'done']));
  });

  it('re-reads a file after a mutating tool (dedupe cleared by the write)', async () => {
    mockStream
      .mockResolvedValueOnce(result({ toolCalls: [{ id: 'c1', name: 'read_file', args: '{"path":"a.ts"}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ toolCalls: [{ id: 'c2', name: 'write_file', args: '{"path":"a.ts","content":"x"}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ toolCalls: [{ id: 'c3', name: 'read_file', args: '{"path":"a.ts"}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ text: 'done' }));
    const runTool = vi.fn(async () => ({ ok: true }));
    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 5, toolSpecs: [], runTool }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('read, write, read'); });

    // The write cleared the read cache, so the SECOND read is NOT suppressed.
    // (chatId 5 has no projectId, so neither the from_delta nor the status backstop fires.)
    expect(runTool).toHaveBeenCalledTimes(3);
  });

  it('advances a linked backlog ticket to in_progress after a code-change run (status backstop)', async () => {
    mockStream
      .mockResolvedValueOnce(result({ toolCalls: [{ id: 'c1', name: 'write_file', args: '{"path":"a.ts","content":"x"}' }], finishReason: 'tool_calls' }))
      .mockResolvedValueOnce(result({ text: 'fixed it' }));
    // The chat has one linked ticket still in backlog; the run changed code but never
    // moved it — exactly the reported "worked a ticket, left it in backlog" case.
    const runTool = vi.fn(async (name: string) => {
      if (name === 'builtin_chats_list_tickets') {
        return [
          { kind: 'task', ref: '488', status: 'backlog', exists: true },
          { kind: 'task', ref: '999', status: 'done', exists: true }, // must NOT be re-touched
        ];
      }
      return { ok: true };
    });
    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 7, projectId: 10, toolSpecs: [], runTool }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('fix the bug'); });

    // The backstop moved the worked backlog ticket to in_progress, and left the done one alone.
    await waitFor(() => expect(runTool).toHaveBeenCalledWith('builtin_tasks_update', { id: 488, status: 'in_progress' }));
    expect(runTool).not.toHaveBeenCalledWith('builtin_tasks_update', { id: 999, status: 'in_progress' });
  });

  it('surfaces a connected-but-unresolved BYO provider on the hook (for the reconnect banner)', async () => {
    mockStream.mockResolvedValueOnce(result({ text: 'ok', byoUnresolved: 'anthropic' }));
    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 4, toolSpecs: [], runTool: vi.fn() }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('hi'); });

    await waitFor(() => expect(hook.current.byoUnresolved).toEqual(['anthropic']));
  });

  it('renders a truthful learn step from the server evermindLearn signal (no client recall)', async () => {
    // The server reports it contributed THIS turn to the project's Evermind — even
    // with NO client-side recall (the connected-but-empty case the old heuristic
    // false-negatived). The learn step must come from the server signal, not a guess.
    // Keyed on ROLE, not call order: durable `llm`/tool STEP rows are persisted
    // between the user and assistant writes, so a `mockImplementationOnce` chain
    // would attach the signal to whichever call happened to land second.
    vi.mocked(persistence.sendMessages).mockImplementation(
      async (_c: number, msgs: Array<{ role: string; content: string; metadata?: string }>) =>
        msgs.map((m) => ({
          id: ++seq, role: m.role, content: m.content, metadata: m.metadata ?? null, seq, createdAt: '',
          ...(m.role === 'assistant' ? { evermindLearn: { learned: true, version: 2 } } : {}),
        })),
    );
    mockStream.mockResolvedValueOnce(result({ text: 'a substantive answer that clears the teach floor with room to spare' }));

    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 11, toolSpecs: [], runTool: vi.fn() }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('teach me'); });

    await waitFor(() => {
      const learn = hook.current.trace.find((e) => e.category === 'learn');
      expect(learn).toBeTruthy();
      expect((learn?.result as { version?: number } | undefined)?.version).toBe(2);
    });
  });

  it('shows NO learn step when the server reports it did not contribute', async () => {
    const noLearn = async (_c: number, msgs: Array<{ role: string; content: string; metadata?: string }>) =>
      msgs.map((m) => ({
        id: ++seq, role: m.role, content: m.content, metadata: m.metadata ?? null, seq, createdAt: '',
        ...(m.role === 'assistant' ? { evermindLearn: { learned: false, version: 0 } } : {}),
      }));
    // Role-keyed (not call-order): durable step rows are persisted between the user
    // and assistant writes, so a `mockImplementationOnce` chain would miss the turn.
    vi.mocked(persistence.sendMessages).mockImplementation(noLearn);
    mockStream.mockResolvedValueOnce(result({ text: 'a plain answer on a non-project or unseeded chat' }));

    const { result: hook } = renderHook(
      () => useBrainConversation({ chatId: 12, toolSpecs: [], runTool: vi.fn() }),
      { wrapper },
    );

    await act(async () => { await hook.current.send('hi'); });
    await waitFor(() => expect(hook.current.messages.map((m) => m.content)).toEqual(['hi', 'a plain answer on a non-project or unseeded chat']));
    expect(hook.current.trace.some((e) => e.category === 'learn')).toBe(false);
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
    // The intermediate turn's narration ('trying') persists as its own block so
    // the next turn's stream can't erase it; the final answer follows.
    await waitFor(() => expect(hook.current.messages.map((m) => m.content)).toEqual(['go', 'trying', 'recovered']));

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
