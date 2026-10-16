/**
 * Rovr's run host on the REAL shared loop (brain-embedded `startRun`) against a scripted
 * stream and the local-first persistence — the wiring a Chrome run depends on: the
 * person's turn lands on the device first, the loop calls Rovr's catalog, the safety gate
 * pauses it on the loop's own confirmation, a decline is recorded, and everything the run
 * wrote is handed to the sync outbox.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRunSnapshot, resetBrainRunStore, type BrainStreamFn, type StreamChatResult } from '@seanhogg/builderforce-brain-embedded';
import { createLocalFirstPersistence } from '../persistence/localFirstPersistence';
import { createMemoryRecords } from '../store/records';
import type { SyncItem } from '../sync/chatSync';
import { BROWSER_TOOL } from '../tools/toolNames';
import { createRovrRunHost, type RunCatalog } from './rovrRunHost';

type Turn = { text?: string; call?: { name: string; args: unknown } };

/** A stream that answers the scripted turns in order (repeating the last). */
function scripted(turns: Turn[]): BrainStreamFn & { calls: number } {
  let i = 0;
  const fn = (async (_opts, handlers) => {
    const turn = turns[Math.min(i, turns.length - 1)]!;
    i += 1;
    fn.calls = i;
    if (turn.text) handlers?.onTextDelta?.(turn.text);
    const result: StreamChatResult = {
      text: turn.text ?? '',
      toolCalls: turn.call ? [{ id: `call_${i}`, name: turn.call.name, args: JSON.stringify(turn.call.args) }] : [],
      finishReason: turn.call ? 'tool_calls' : 'stop',
    } as StreamChatResult;
    return result;
  }) as BrainStreamFn & { calls: number };
  fn.calls = 0;
  return fn;
}

function setup(turns: Turn[], gate: (name: string) => boolean = () => false) {
  const records = createMemoryRecords();
  const handed: Array<{ chatId: number; items: SyncItem[] }> = [];
  const persistence = createLocalFirstPersistence(records, { enqueue: (chatId, items) => handed.push({ chatId, items }) });
  const ran: Array<{ name: string; args: unknown }> = [];
  const declined: Array<{ chatId: number; name: string }> = [];
  const catalog: RunCatalog = {
    specs: [
      { type: 'function', function: { name: BROWSER_TOOL.read, description: 'Read the page in the working tab.', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: BROWSER_TOOL.click, description: 'Click an element by ref.', parameters: { type: 'object', properties: { ref: { type: 'string' } } } } },
    ],
    run: async (name, args) => {
      ran.push({ name, args });
      return { ok: true, content: 'Welcome to the shop.' };
    },
    needsConfirm: (req) => gate(req.name),
  };
  const stream = scripted(turns);
  const host = createRovrRunHost({
    stream,
    persistence,
    history: (chatId) => records.listMessages(chatId),
    catalog: async () => catalog,
    systemPrompt: async () => 'You are Rovr.',
    onDeclined: (chatId, call) => declined.push({ chatId, name: call.name }),
  });
  return { host, records, handed, ran, declined, stream };
}

let chatId = -9000;
const nextChat = () => (chatId -= 1);

afterEach(() => resetBrainRunStore());

describe('Rovr run host', () => {
  it('persists the turn on the device, runs the shared loop with Rovr\'s catalog, and hands every row to sync', async () => {
    const id = nextChat();
    const { host, records, handed, ran } = setup([{ call: { name: BROWSER_TOOL.read, args: {} } }, { text: 'The shop welcomes you.' }]);
    await host.send(id, '  what does this page say?  ');

    expect(ran).toEqual([{ name: BROWSER_TOOL.read, args: {} }]);
    const conversation = (await records.listMessages(id)).filter((m) => m.role !== 'tool');
    expect(conversation.map((m) => [m.role, m.content])).toEqual([
      ['user', 'what does this page say?'],
      ['assistant', 'The shop welcomes you.'],
    ]);
    const synced = handed.flatMap((h) => h.items.map((item) => (item.kind === 'message' ? item.row.role : item.kind)));
    expect(synced).toContain('user');
    expect(synced).toContain('assistant');
    expect(handed.every((h) => h.chatId === id)).toBe(true);
  });

  it('pauses on the safety gate, and a decline is recorded and never executed', async () => {
    const id = nextChat();
    const { host, ran, declined } = setup(
      [{ call: { name: BROWSER_TOOL.click, args: { ref: 'e3' } } }, { text: 'Understood, I left it alone.' }],
      (name) => name === BROWSER_TOOL.click,
    );
    const running = host.send(id, 'press buy');
    await vi.waitFor(() => expect(getRunSnapshot(id).pendingConfirm?.name).toBe(BROWSER_TOOL.click));
    host.confirm(id, false);
    await running;

    expect(ran).toEqual([]);
    expect(declined).toEqual([{ chatId: id, name: BROWSER_TOOL.click }]);
  });

  it('ignores an empty turn and a second send while one is being set up', async () => {
    const id = nextChat();
    const { host, stream, records } = setup([{ text: 'Hi.' }]);
    await host.send(id, '   ');
    expect(stream.calls).toBe(0);
    await Promise.all([host.send(id, 'hello'), host.send(id, 'hello again')]);
    const turns = (await records.listMessages(id)).filter((m) => m.role === 'user').map((m) => m.content);
    expect(turns).toEqual(['hello']);
  });
});
