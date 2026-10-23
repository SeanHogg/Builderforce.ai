/**
 * Rovr's run-time parts (`prepareRun`) and device-record persistence on the REAL shared
 * loop (brain-embedded `startRun`), started exactly as THE shared conversation
 * (`useBrainConversation`'s `launch`) starts it: the hook's request with `prepareRun`'s
 * parts laid over it, the person's turn written first through the persistence port. The
 * wiring a Chrome run depends on: the turn lands on the device first, the loop calls
 * Rovr's catalog bound to THIS chat and Rovr's prompt, the safety gate pauses it on the
 * loop's own confirmation, a decline is recorded, and everything the run wrote is handed
 * to the sync outbox. The hook's own turn behaviour (send, the refused turn's re-send
 * with no duplicate user row) is pinned in brain-embedded's `useBrainConversation.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRunSnapshot, resetBrainRunStore, startRun, transcriptSeedFrom, type BrainStreamFn, type StreamChatResult } from '@seanhogg/builderforce-brain-embedded';
import { createLocalFirstPersistence } from '../persistence/localFirstPersistence';
import { createRovrBrainPersistence } from '../persistence/rovrBrainPersistence';
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
  const persistence = createRovrBrainPersistence(records, createLocalFirstPersistence(records, { enqueue: (chatId, items) => handed.push({ chatId, items }) }));
  const ran: Array<{ name: string; args: unknown }> = [];
  const declined: Array<{ chatId: number; name: string }> = [];
  const catalogFor: number[] = [];
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
    catalog: async (id) => { catalogFor.push(id); return catalog; },
    systemPrompt: async () => 'You are Rovr.',
    onDeclined: (id, call) => declined.push({ chatId: id, name: call.name }),
  });
  /** One turn, as the shared conversation sends it: persist, then launch with `prepareRun`. */
  const send = async (id: number, text: string) => {
    const prior = await persistence.getMessages(id);
    await persistence.sendMessages(id, [{ role: 'user', content: text }]);
    await startRun(id, {
      resolvedSystemPrompt: '',
      stream,
      persistence,
      seed: transcriptSeedFrom(prior),
      userTurn: text,
      ...(await host.prepareRun(id)),
    });
  };
  return { host, send, records, persistence, handed, ran, declined, stream, catalogFor };
}

let chatId = -9000;
const nextChat = () => (chatId -= 1);

afterEach(() => resetBrainRunStore());

describe("Rovr's run-time parts on the shared run", () => {
  it("runs the shared loop with Rovr's catalog bound to the chat, persists on the device, and hands every row to sync", async () => {
    const id = nextChat();
    const { send, records, handed, ran, catalogFor } = setup([{ call: { name: BROWSER_TOOL.read, args: {} } }, { text: 'The shop welcomes you.' }]);
    await send(id, 'what does this page say?');

    expect(catalogFor).toEqual([id]);
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
    const { host, send, ran, declined } = setup(
      [{ call: { name: BROWSER_TOOL.click, args: { ref: 'e3' } } }, { text: 'Understood, I left it alone.' }],
      (name) => name === BROWSER_TOOL.click,
    );
    const running = send(id, 'press buy');
    await vi.waitFor(() => expect(getRunSnapshot(id).pendingConfirm?.name).toBe(BROWSER_TOOL.click));
    host.confirm(id, false);
    await running;

    expect(ran).toEqual([]);
    expect(declined).toEqual([{ chatId: id, name: BROWSER_TOOL.click }]);
  });

  it("the conversation's persistence reads the device record and refuses what Rovr's conversation never does", async () => {
    const id = nextChat();
    const { persistence, records } = setup([{ text: 'Hi.' }]);
    await records.appendMessages(id, [{ role: 'user', content: 'hello' }]);
    expect((await persistence.getMessages(id)).map((m) => m.content)).toEqual(['hello']);
    await expect(persistence.createChat({ title: 'x' })).rejects.toThrow(/device record/);
    await expect(persistence.upload({} as File)).rejects.toThrow(/device record/);
  });
});
