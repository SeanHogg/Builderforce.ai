/**
 * The editor chat's wiring of THE turn door (`useChatTurns`): what it counts as "in flight" (a send
 * saving its row, or fetching its limbic block, already is) versus "live" (the run store says a run is
 * executing or being made), and the steer port, which asks the door's own predicate - the one the Send
 * label reads. Rendered through the real hook on the server renderer (the package has no DOM): state
 * starts at its initial value, so the pre-send window itself is covered by the door's own tests
 * (`brain-embedded/src/useChatTurns.test.tsx`); here the conversation's two flags are what vary.
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

import { useChatSend } from './useChatSend';

type Turn = { text: string; recipient: unknown; attachments?: unknown[] };
type Steer = (turn: Turn) => boolean;

/** Renders the hook once and returns what it gives the composer, with the pieces a test pokes at. */
function mount(flags: { sending: boolean; runLive: boolean }, chatId: number | null = 5) {
  const conv = { ...flags, pendingAttachments: [], removeAttachment: vi.fn(), restoreAttachments: vi.fn(), send: vi.fn(async () => true), stop: vi.fn() };
  const setInput = vi.fn();
  const chooseRecipient = vi.fn();
  let sendSteers: boolean | undefined;
  const Probe = () => {
    sendSteers = useChatSend({
      conv: conv as never, chatId, input: '', setInput, recipient: null, chooseRecipient,
      liveChildren: [] as never, setTurnLimbic: vi.fn(), reloadChats: vi.fn(),
    }).sendSteers;
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  return { conv, setInput, chooseRecipient, sendSteers: sendSteers as boolean, steer: door.options!.steer as Steer, options: door.options! };
}

beforeEach(() => steerRun.mockClear());

describe('the editor chat\'s turn door is told the run store\'s state', () => {
  it('a live run: held-behind AND steerable, and the Send label says so', () => {
    const { sendSteers, steer, options } = mount({ sending: true, runLive: true });

    expect(options).toMatchObject({ running: true, steerable: true });
    expect(sendSteers).toBe(true);
    expect(steer({ text: 'do it now', recipient: null, attachments: [] })).toBe(true);
    expect(steerRun).toHaveBeenCalledWith(5, 'do it now', []);
  });

  it('a send still saving (in flight, no run yet): turns are HELD in order - never steered into an inbox nothing reads', () => {
    const { sendSteers, steer, options } = mount({ sending: true, runLive: false });

    expect(options).toMatchObject({ running: true, steerable: false });
    expect(sendSteers).toBe(false);
    expect(steer({ text: 'second turn', recipient: null, attachments: [] })).toBe(false);
    expect(steerRun).not.toHaveBeenCalled();
  });

  it('nothing in flight: the turn is sent, and the label is not a steer', () => {
    const { sendSteers, steer, options } = mount({ sending: false, runLive: false });

    expect(options).toMatchObject({ running: false, steerable: false });
    expect(sendSteers).toBe(false);
    expect(steer({ text: 'not yet', recipient: null, attachments: [] })).toBe(false);
  });

  it('declines for a chat that has no id yet', () => {
    const { steer } = mount({ sending: true, runLive: true }, null);
    expect(steer({ text: 'no chat', recipient: null, attachments: [] })).toBe(false);
    expect(steerRun).not.toHaveBeenCalled();
  });
});

describe('an addressed turn the door could not keep', () => {
  it('returns to the composer with its text, files and addressee', () => {
    const { options, conv, setInput, chooseRecipient } = mount({ sending: false, runLive: false });
    const dev = { kind: 'agent', ref: 'dev', label: 'dev' };
    const file = { key: 'k', name: 'a.txt', type: 'text/plain' };

    (options.restore as (m: Turn) => void)({ text: '@dev look', recipient: dev, attachments: [file] });

    const put = setInput.mock.calls[0]![0] as (cur: string) => string;
    expect(put('')).toBe('@dev look');
    expect(put('already typing')).toBe('already typing');
    expect(conv.restoreAttachments).toHaveBeenCalledWith([file]);
    expect(chooseRecipient).toHaveBeenCalledWith(dev);
  });

  it('resets the composer\'s addressee for a turn that had none - a Brain turn never comes back pointed at a participant', () => {
    const { options, chooseRecipient } = mount({ sending: false, runLive: false });

    (options.restore as (m: Turn) => void)({ text: 'plain', recipient: null });

    expect(chooseRecipient).toHaveBeenCalledWith(null);
  });
});
