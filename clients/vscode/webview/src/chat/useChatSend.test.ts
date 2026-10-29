/**
 * The editor chat's wiring of THE turn door (`useChatTurns`): what it counts as "in flight" (a send
 * fetching its limbic block already is) versus "live" (a run exists and can be spoken to), and the
 * steer port, which asks the door's own predicate - the one the Send label reads.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const steerRun = vi.hoisted(() => vi.fn());
const door = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined }));

vi.mock('../vscodeBridge', () => ({ request: vi.fn(async () => ({ block: '' })) }));
vi.mock('./chatChildren', () => ({ childTarget: () => null, steerRun }));
vi.mock('@seanhogg/builderforce-brain-embedded', async (importOriginal) => {
  const real = await importOriginal<typeof import('@seanhogg/builderforce-brain-embedded')>();
  return {
    ...real,
    useRunRefreshTick: () => 0,
    useChatTurns: (options: Record<string, unknown>) => {
      door.options = options;
      return real.useChatTurns(options as never);
    },
  };
});

import { chatRunLiveness, useChatSend } from './useChatSend';

type Steer = (turn: { text: string; recipient: null; attachments: unknown[] }) => boolean;

/** Renders the hook once (server render: state starts at its initial value) and returns what it gives the composer. */
function mount(sending: boolean, chatId: number | null = 5) {
  const conv = { sending, pendingAttachments: [], removeAttachment: vi.fn(), restoreAttachments: vi.fn(), send: vi.fn(async () => true), stop: vi.fn() };
  let sendSteers: boolean | undefined;
  const Probe = () => {
    sendSteers = useChatSend({
      conv: conv as never, chatId, input: '', setInput: vi.fn(), recipient: null,
      liveChildren: [] as never, setTurnLimbic: vi.fn(), reloadChats: vi.fn(),
    }).sendSteers;
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  return { sendSteers: sendSteers as boolean, steer: door.options!.steer as Steer, options: door.options! };
}

beforeEach(() => steerRun.mockClear());

describe('chatRunLiveness', () => {
  it('holds behind the limbic fetch but steers only once the run is live', () => {
    expect(chatRunLiveness(false, false)).toEqual({ running: false, steerable: false });
    // The preparing window: a send is in flight, no run exists yet - a second turn is HELD, never steered.
    expect(chatRunLiveness(false, true)).toEqual({ running: true, steerable: false });
    expect(chatRunLiveness(true, false)).toEqual({ running: true, steerable: true });
  });
});

describe('the editor chat\'s steer port', () => {
  it('steers the chat\'s own live run, and the Send label says so (one predicate)', () => {
    const { sendSteers, steer, options } = mount(true);

    expect(options).toMatchObject({ running: true, steerable: true });
    expect(sendSteers).toBe(true);
    expect(steer({ text: 'do it now', recipient: null, attachments: [] })).toBe(true);
    expect(steerRun).toHaveBeenCalledWith(5, 'do it now', []);
  });

  it('declines when there is no live run to speak to - the turn is held, and the label says Queue', () => {
    const { sendSteers, steer, options } = mount(false);

    expect(options).toMatchObject({ running: false, steerable: false });
    expect(sendSteers).toBe(false);
    expect(steer({ text: 'not yet', recipient: null, attachments: [] })).toBe(false);
    expect(steerRun).not.toHaveBeenCalled();
  });

  it('declines for a chat that has no id yet', () => {
    const { steer } = mount(true, null);
    expect(steer({ text: 'no chat', recipient: null, attachments: [] })).toBe(false);
    expect(steerRun).not.toHaveBeenCalled();
  });
});
