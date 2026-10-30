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
const door = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined, queueAfter: undefined as ReturnType<typeof vi.fn> | undefined }));

vi.mock('../vscodeBridge', () => ({ request: vi.fn(async () => ({ block: '' })) }));
vi.mock('./chatChildren', () => ({ childTarget: () => null, steerRun }));
vi.mock('@seanhogg/builderforce-brain-embedded', async (importOriginal) => {
  const real = await importOriginal<typeof import('@seanhogg/builderforce-brain-embedded')>();
  return {
    ...real,
    useRunRefreshTick: () => 0,
    useChatTurns: (options: Record<string, unknown>) => {
      door.options = options;
      const turns = real.useChatTurns(options as never);
      door.queueAfter = vi.fn(async () => true); // observed, not run: this render is never mounted
      return { ...turns, queueAfter: door.queueAfter } as never;
    },
  };
});

import { useChatSend } from './useChatSend';

type Turn = { text: string; recipient: unknown; attachments?: unknown[] };
type Steer = (turn: Turn) => boolean;

/** Renders the hook once and returns what it gives the composer, with the pieces a test pokes at. */
function mount(flags: { sending: boolean; runLive: boolean }, chatId: number | null = 5, input = '') {
  const conv = { ...flags, pendingAttachments: [], removeAttachment: vi.fn(), restoreAttachments: vi.fn(), send: vi.fn(async () => true), stop: vi.fn() };
  const setInput = vi.fn();
  const chooseRecipient = vi.fn();
  let api: ReturnType<typeof useChatSend> | undefined;
  const Probe = () => {
    api = useChatSend({
      conv: conv as never, chatId, input, setInput, recipient: null, chooseRecipient,
      liveChildren: [] as never, setTurnLimbic: vi.fn(), reloadChats: vi.fn(),
    });
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  return { conv, setInput, chooseRecipient, api: api!, sendSteers: api!.sendSteers, steer: door.options!.steer as Steer, options: door.options! };
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

/** What the box holds if it held `current` when the (single, updater) write landed - a turn is given back through an updater. */
const boxAfter = (setInput: ReturnType<typeof vi.fn>, current: string): string => (setInput.mock.calls.at(-1)![0] as (cur: string) => string)(current);

describe('an addressed turn the door could not keep', () => {
  it('returns to the composer with its text, files and addressee', () => {
    const { options, conv, setInput, chooseRecipient } = mount({ sending: false, runLive: false });
    const dev = { kind: 'agent', ref: 'dev', label: 'dev' };
    const file = { key: 'k', name: 'a.txt', type: 'text/plain' };

    (options.restore as (m: Turn) => void)({ text: '@dev look', recipient: dev, attachments: [file] });

    expect(boxAfter(setInput, '')).toBe('@dev look');
    expect(conv.restoreAttachments).toHaveBeenCalledWith([file]);
    expect(chooseRecipient).toHaveBeenCalledWith(dev);
  });

  it('resets the composer\'s addressee for a turn that had none - a Brain turn never comes back pointed at a participant', () => {
    const { options, chooseRecipient } = mount({ sending: false, runLive: false });

    (options.restore as (m: Turn) => void)({ text: 'plain', recipient: null });

    expect(chooseRecipient).toHaveBeenCalledWith(null);
  });

  it('a NEWER draft keeps its addressee and its words when a turn is given back: the older words go in front of them, and the files return', () => {
    const { options, conv, setInput, chooseRecipient } = mount({ sending: false, runLive: false }, 5, 'typed since');
    const file = { key: 'k', name: 'a.txt', type: 'text/plain' };

    (options.restore as (m: Turn) => void)({ text: 'older', recipient: { kind: 'agent', ref: 'dev' }, attachments: [file] });

    expect(boxAfter(setInput, 'typed since')).toBe('older' + String.fromCharCode(10, 10) + 'typed since');
    expect(chooseRecipient).not.toHaveBeenCalled();
    expect(conv.restoreAttachments).toHaveBeenCalledWith([file]);
  });
});

describe('"Queue for after" goes through THE door', () => {
  it('holds the typed message with the queueAfter of the door - the one that knows about a draft creation - never the raw queue', () => {
    const { api } = mount({ sending: true, runLive: true }, null, 'do this after');

    api.queueAfter();

    expect(door.queueAfter).toHaveBeenCalledTimes(1);
    expect(door.queueAfter).toHaveBeenCalledWith({ text: 'do this after', recipient: null, attachments: [] });
  });

  it('a blank box offers nothing', () => {
    const { api } = mount({ sending: true, runLive: true }, null, '   ');
    api.queueAfter();
    expect(door.queueAfter).not.toHaveBeenCalled();
  });
});

describe('Stop reaches only the draft on screen', () => {
  const settles = (p: Promise<boolean>): Promise<boolean | 'preparing'> => Promise.race([p, new Promise<'preparing'>((resolve) => setTimeout(() => resolve('preparing'), 30))]);
  const ports = () => {
    const { options, conv } = mount({ sending: false, runLive: false }, null);
    return { conv, send: options.send as (turn: Turn, ctx?: { draft?: number }) => Promise<boolean>, stop: options.stop as (draft?: number) => void };
  };

  it("a Stop on ANOTHER draft's token does not cancel draft 1's send that is still preparing", async () => {
    const { conv, send, stop } = ports();

    const d1 = send({ text: 'D1', recipient: null }, { draft: 1 }); // draft 1 is fetching its limbic block
    stop(2); // the draft showing now is another one

    expect(await settles(d1)).toBe('preparing'); // not dropped: it staged and awaits its commit
    expect(conv.stop).toHaveBeenCalledWith(2);
  });

  it("a Stop on the draft's own token drops its preparing send", async () => {
    const { send, stop } = ports();

    const d1 = send({ text: 'D1', recipient: null }, { draft: 1 });
    stop(1);

    expect(await settles(d1)).toBe(false);
  });
});
