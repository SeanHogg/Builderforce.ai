import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { useBrainChats, useBrainConversation } from '@/lib/brain';
import { useBrainPanelTurns, type BrainPanelTurn } from './useBrainPanelTurns';

/** The shared turn door, stubbed: what it was configured with, and what was offered through it. */
const door = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  submit: vi.fn(),
  queueAfter: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('@seanhogg/builderforce-brain-embedded', () => ({
  useChatTurns: (options: Record<string, unknown>) => {
    door.options = options;
    return { queued: { items: [], count: 0, remove: vi.fn() }, submit: door.submit, queueAfter: door.queueAfter, stop: door.stop, steers: () => true };
  },
}));
vi.mock('@/lib/brain/dockedBrain', () => ({ useDockedComposer: vi.fn() }));
vi.mock('@/lib/activity/tracker', () => ({ trackActivity: vi.fn() }));
vi.mock('@/lib/academic/useAssistantGate', () => ({ useAssistantGate: () => ({ assistantAllowed: true }) }));

type Conv = ReturnType<typeof useBrainConversation>;
type Chats = ReturnType<typeof useBrainChats>;

const notes = { key: 'n1', name: 'notes.txt', type: 'text/plain' };

function conversation(pending = [notes]) {
  const send = vi.fn(async () => true);
  const removeAttachment = vi.fn();
  const restoreAttachments = vi.fn();
  const conv = { sending: false, stop: vi.fn(), send, pendingAttachments: pending, removeAttachment, restoreAttachments } as unknown as Conv;
  return { conv, send, removeAttachment, restoreAttachments };
}

function mount(conv: Conv, input = 'fix the build') {
  const setInput = vi.fn();
  const chats = { activeChatId: 7 } as unknown as Chats;
  const hook = renderHook((props: { conv: Conv }) => useBrainPanelTurns({
    conv: props.conv, chats, recipient: null, input, setInput, showChatTab: vi.fn(), acceptsHandover: false,
  }), { initialProps: { conv } });
  return { hook, setInput };
}

beforeEach(() => {
  door.submit.mockReset().mockResolvedValue(true);
  door.queueAfter.mockReset().mockResolvedValue(true);
});

describe('the web panel\'s turn door and the composer\'s attachments', () => {
  it('takes the box\'s attachments out of the composer as the offer STARTS - a send in flight for the whole run leaves none behind', async () => {
    const { conv, removeAttachment } = conversation();
    const { hook, setInput } = mount(conv);
    let finish!: (kept: boolean) => void;
    door.submit.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));

    let offered!: Promise<void>;
    act(() => { offered = hook.result.current.handleSend() as Promise<void>; });

    expect(removeAttachment).toHaveBeenCalledWith('n1');
    await act(async () => { finish(true); await offered; });

    expect(door.submit).toHaveBeenCalledWith({ text: 'fix the build', addressedTo: null, attachments: [notes] });
    expect(setInput).toHaveBeenCalledWith('');
    expect(removeAttachment).toHaveBeenCalledWith('n1');
  });

  it('puts the attachments back - and the text - when the turn was not kept', async () => {
    door.submit.mockResolvedValue(false);
    const { conv, restoreAttachments } = conversation();
    const { hook, setInput } = mount(conv);

    await act(async () => { await hook.result.current.handleSend(); });

    expect(restoreAttachments).toHaveBeenCalledWith([notes]);
    const restore = setInput.mock.calls.map((c) => c[0]).find((v) => typeof v === 'function') as ((cur: string) => string) | undefined;
    expect(restore?.('')).toBe('fix the build');
  });

  it('holds the box for after the run through the explicit queue, files included', async () => {
    const { conv, removeAttachment } = conversation();
    const { hook } = mount(conv);

    await act(async () => { await hook.result.current.handleQueueAfter(); });

    expect(door.queueAfter).toHaveBeenCalledWith({ text: 'fix the build', addressedTo: null, attachments: [notes] });
    expect(door.submit).not.toHaveBeenCalled();
    expect(removeAttachment).toHaveBeenCalledWith('n1');
  });

  it('sends every turn WITH its own attachments - none included - so a flushed held turn never takes the composer\'s', async () => {
    const { conv, send } = conversation();
    mount(conv);
    const sendTurn = door.options?.send as (turn: BrainPanelTurn) => Promise<boolean>;

    await sendTurn({ text: 'a held turn', addressedTo: null });

    expect(send).toHaveBeenCalledWith('a held turn', { addressedTo: null, attachments: [] });
  });

  it('hands the door the files a steer would carry', () => {
    mount(conversation().conv);
    const attachmentsOf = door.options?.attachmentsOf as (turn: BrainPanelTurn) => unknown;

    expect(attachmentsOf({ text: 't', addressedTo: null, attachments: [notes] })).toEqual([notes]);
  });

  it('keeps the composer\'s handlers when only the conversation object changes (it changes on every token)', () => {
    const first = conversation();
    const { hook } = mount(first.conv);
    const send = hook.result.current.handleSend;
    const queue = hook.result.current.handleQueueAfter;

    hook.rerender({ conv: conversation().conv });

    expect(hook.result.current.handleSend).toBe(send);
    expect(hook.result.current.handleQueueAfter).toBe(queue);
  });
});
