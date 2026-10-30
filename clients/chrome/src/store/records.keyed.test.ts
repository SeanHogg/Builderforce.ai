/**
 * A message row saved AGAIN under the key it was saved with is the same row - in BOTH Rovr stores (the in-memory
 * one and the IndexedDB one), through the one shared decision (`slotKeyedRows`) and the one shared answer
 * (`assembleAppend`). This is what lets a save that timed out and landed late, then was saved again from the requeued
 * words, make one row and not two - and what keeps the sync outbox from sending it twice.
 *
 * The IndexedDB store runs against `fake-indexeddb`, a complete implementation of the API (transactions, indexes,
 * upgrades), so what is proved here is the store's own use of IndexedDB and not a stand-in's.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIdbRecords } from './idbRecords';
import { createMemoryRecords, type RovrRecords } from './records';

let n = 0;
const stores: Array<[string, () => RovrRecords]> = [
  ['memory', () => createMemoryRecords()],
  ['IndexedDB', () => createIdbRecords(new IDBFactory(), `rovr-test-${(n += 1)}`)],
];

describe.each(stores)('the Rovr %s store: a row saved again under its key is the same row', (_name, make) => {
  it('returns the saved row and writes nothing new', async () => {
    const records = make();
    const chat = await records.createChat('keyed');

    const { messages: [first] } = await records.appendMessages(chat.id, [{ role: 'user', content: 'said once', eventKey: 'steer:a' }]);
    const { messages: [again], written } = await records.appendMessages(chat.id, [{ role: 'user', content: 'said once', eventKey: 'steer:a' }]);

    expect(again?.id).toBe(first?.id);
    expect(written).toEqual([]); // nothing was stored: nothing for the sync outbox to send
    expect((await records.listMessages(chat.id)).map((m) => m.content)).toEqual(['said once']);
  });

  it('a key repeated inside ONE batch is one row, answered twice; rows without a key are always new', async () => {
    const records = make();
    const chat = await records.createChat('batch');

    const { messages: saved, written } = await records.appendMessages(chat.id, [
      { role: 'user', content: 'X', eventKey: 'steer:x' },
      { role: 'user', content: 'plain' },
      { role: 'user', content: 'X', eventKey: 'steer:x' },
      { role: 'user', content: 'plain' },
    ]);

    expect(saved[2]?.id).toBe(saved[0]?.id);
    expect(written.map((row) => row.content)).toEqual(['X', 'plain', 'plain']);
    expect((await records.listMessages(chat.id)).map((m) => m.content)).toEqual(['X', 'plain', 'plain']);
  });

  it('in a batch that mixes a known key with new rows, only the new ones are reported written', async () => {
    const records = make();
    const chat = await records.createChat('mixed');
    await records.appendMessages(chat.id, [{ role: 'user', content: 'old', eventKey: 'steer:old' }]);

    const { messages, written } = await records.appendMessages(chat.id, [
      { role: 'user', content: 'old', eventKey: 'steer:old' },
      { role: 'user', content: 'new', eventKey: 'steer:new' },
    ]);

    expect(messages.map((m) => m.content)).toEqual(['old', 'new']);
    expect(written.map((row) => row.content)).toEqual(['new']);
  });

  it('keeps a key per chat, and never shows the key to a caller', async () => {
    const records = make();
    const a = await records.createChat('a');
    const b = await records.createChat('b');

    await records.appendMessages(a.id, [{ role: 'user', content: 'in a', eventKey: 'steer:same' }]);
    await records.appendMessages(b.id, [{ role: 'user', content: 'in b', eventKey: 'steer:same' }]);

    expect((await records.listMessages(a.id)).map((m) => m.content)).toEqual(['in a']);
    expect((await records.listMessages(b.id)).map((m) => m.content)).toEqual(['in b']);
    expect(Object.keys((await records.listMessages(a.id))[0]!)).not.toContain('eventKey');
  });

  it('two appends of the SAME key at once make ONE row (a save that timed out, landing as its retry arrives)', async () => {
    const records = make();
    const chat = await records.createChat('race');

    const [one, two] = await Promise.all([
      records.appendMessages(chat.id, [{ role: 'user', content: 'once', eventKey: 'steer:race' }]),
      records.appendMessages(chat.id, [{ role: 'user', content: 'once', eventKey: 'steer:race' }]),
    ]);

    expect((await records.listMessages(chat.id)).map((m) => m.content)).toEqual(['once']);
    expect(one.messages[0]?.id).toBe(two.messages[0]?.id);
    expect(one.written.length + two.written.length).toBe(1); // exactly one of them stored it
  });
});

describe('the IndexedDB store: the [chatId, eventKey] index (schema version 2)', () => {
  it('upgrades a version-1 database in place: rows saved before keep their keys, and a repeat of one is still the same row', async () => {
    const factory = new IDBFactory();
    // A version-1 database as the previous build left it: no key index, one keyed row.
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('rovr-upgrade', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('chats', { keyPath: 'id' });
        db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true }).createIndex('byChat', 'chatId');
        db.createObjectStore('tasks', { keyPath: 'id' }).createIndex('byChat', 'chatId');
        db.createObjectStore('ledger', { keyPath: 'id' }).createIndex('byChat', 'chatId');
      };
      req.onsuccess = () => {
        const tx = req.result.transaction('messages', 'readwrite');
        tx.objectStore('messages').add({ chatId: 7, role: 'user', content: 'from before', metadata: null, createdAt: 't', eventKey: 'steer:before' });
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const records = createIdbRecords(factory, 'rovr-upgrade');
    const { messages, written } = await records.appendMessages(7, [{ role: 'user', content: 'from before', eventKey: 'steer:before' }]);

    expect(written).toEqual([]);
    expect(messages[0]?.content).toBe('from before');
    expect((await records.listMessages(7)).map((m) => m.content)).toEqual(['from before']);
  });
});
