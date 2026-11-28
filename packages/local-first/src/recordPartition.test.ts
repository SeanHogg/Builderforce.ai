import { describe, expect, it } from 'vitest';
import {
  createMemoryLocalFirstStore,
  defineRecordIndex,
  defineRecordPartition,
  homeOfRow,
  newLocalRecord,
  partitionDeclarationOf,
  partitionIdOf,
  stubOf,
  type LocalRecord,
} from './index.js';

interface Msg { chatId?: number; n: number }

const BY_CHAT = defineRecordIndex<Msg>('message', 'test.recordPartition.chat', (row) => row.payload.chatId);
const PARTITION = defineRecordPartition<Msg>({
  index: BY_CHAT,
  // The index's key ignoring `deletedAt`: a tombstone keeps its home.
  homeOf: (row) => row.payload.chatId,
  ordinalOf: (row) => row.payload.n,
});

const msg = (id: string, chatId: number | undefined, n = 1): LocalRecord<Msg> =>
  newLocalRecord<Msg>({ id, entityType: 'message', payload: { chatId, n }, deviceId: 'dev-a', occurredAt: '2026-11-10T00:00:00.000Z' });

describe('record partition', () => {
  it('regression: a stub carries what the hot paths read without the row', () => {
    const row = { ...msg('m1', 7, 42), version: 3 };
    expect(stubOf(PARTITION, row)).toEqual({
      id: 'm1',
      entityType: 'message',
      home: 7,
      version: 3,
      deleted: false,
      deviceId: 'dev-a',
      source: 'local',
      destinationKey: 'unbound',
      unbound: true,
      ordinal: 42,
    });
  });

  it('regression: a tombstoned row keeps its home, and the index drops it', () => {
    const tomb = { ...msg('m1', 7), deletedAt: '2026-11-11T00:00:00.000Z' };
    expect(homeOfRow(PARTITION, tomb)).toBe(7);
    expect(stubOf(PARTITION, tomb)?.deleted).toBe(true);
    expect(BY_CHAT.keyOf(tomb)).toBe(7); // the key function alone ignores deletedAt; `indexKeyOf` is what drops it
  });

  it('regression: a row with no home is unpartitioned and has no stub', () => {
    expect(stubOf(PARTITION, msg('m1', undefined))).toBeUndefined();
  });

  it('regression: a homeOf or ordinalOf that throws fails the write instead of hiding the row in main', async () => {
    const badHome = defineRecordPartition<Msg>({ index: BY_CHAT, homeOf: () => { throw new Error('malformed'); } });
    expect(() => stubOf(badHome, msg('m1', 1))).toThrow('malformed');
    const badOrdinal = defineRecordPartition<Msg>({ index: BY_CHAT, homeOf: (row) => row.payload.chatId, ordinalOf: () => { throw new Error('no ordinal'); } });
    const store = createMemoryLocalFirstStore(undefined, { partitions: [badOrdinal] });
    await expect(store.transact((tx) => tx.put(msg('m1', 1)))).rejects.toThrow('no ordinal');
    expect(store.view().stubs).toBeUndefined();
  });

  it('regression: provenance in the stub reads as isOwnRecord does', () => {
    const imported = { ...msg('m1', 1), provenance: { deviceId: 'dev-b', source: 'imported' as const } };
    expect(stubOf(PARTITION, imported)).toMatchObject({ deviceId: 'dev-b', source: 'imported' });
    const { provenance: _provenance, ...bare } = msg('m2', 1);
    expect(stubOf(PARTITION, bare)).toMatchObject({ deviceId: '', source: 'local' });
  });

  it('regression: a partition id is one helper, per type and home', () => {
    expect(partitionIdOf('message', 7)).toBe('message\u00007');
    expect(partitionIdOf('message', 7)).not.toBe(partitionIdOf('chat', 7));
    expect(partitionDeclarationOf(PARTITION)).toEqual({ entityType: 'message', index: 'test.recordPartition.chat' });
  });
});
