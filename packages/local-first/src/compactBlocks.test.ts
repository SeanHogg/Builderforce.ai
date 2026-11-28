import { describe, expect, it } from 'vitest';
import {
  createMemoryLocalFirstStore,
  defineRecordIndex,
  defineRecordPartition,
  encodeDeltaFrame,
  newLocalRecord,
  scanJournal,
  snapshotFrames,
  type LocalFirstSnapshot,
  type RecordStub,
  type ServerMapping,
} from './index.js';
import { decodeMappingBlock, decodeStubBlock, encodeMappingBlock, encodeStubBlock } from './compactBlocks.js';

interface Msg { chatId: number; n: number }
const BY_CHAT = defineRecordIndex<Msg>('message', 'test.compactBlocks.chat', (row) => row.payload.chatId);
const PARTITION = defineRecordPartition<Msg>({ index: BY_CHAT, homeOf: (row) => row.payload.chatId, ordinalOf: (row) => row.payload.n });

const BOUND = { kind: 'bound', tenantId: 't1', projectId: 'p1' } as const;
const stub = (id: string, home: number, extra: Partial<RecordStub> = {}): RecordStub => ({
  id, entityType: 'message', home, version: 1, deleted: false, deviceId: 'dev-a', source: 'local', destinationKey: 'unbound', unbound: true, ...extra,
});
const mapping = (id: string, extra: Partial<ServerMapping> = {}): ServerMapping => ({
  destination: BOUND, entityType: 'message', clientEntityId: id, syncId: 10, serverVersion: 2, serverId: '10', mappedSeq: 1, ...extra,
});

const noPause = (): Promise<void> => Promise.resolve();
async function baseBytes(snapshot: LocalFirstSnapshot): Promise<Uint8Array> {
  const frames: Uint8Array[] = [];
  for await (const frame of snapshotFrames(snapshot, noPause)) frames.push(frame);
  const out = new Uint8Array(frames.reduce((total, frame) => total + frame.byteLength, 0));
  let at = 0;
  for (const frame of frames) { out.set(frame, at); at += frame.byteLength; }
  return out;
}

describe('compact base blocks', () => {
  it('regression: a stub block decodes to the stubs it was made from, with its strings interned', () => {
    const stubs = [
      stub('m1', 1, { ordinal: 4 }),
      stub('m2', 1, { deleted: true, deviceId: 'dev-b', source: 'imported', destinationKey: 'k1', unbound: false }),
      stub('m3', 2),
    ];
    const block = encodeStubBlock(stubs);
    expect(decodeStubBlock(block)).toEqual(stubs);
    expect(block.devices).toEqual(['dev-a', 'dev-b']);
    expect(block.destinations).toEqual(['unbound', 'k1']);
    expect(block.types).toEqual(['message']);
  });

  it('regression: a mapping block keeps an absent syncId distinct from an explicit null', () => {
    const rows = [
      mapping('a'),
      mapping('b', { syncId: null, serverId: undefined }),
      (({ syncId: _gone, ...rest }) => rest)(mapping('c')) as ServerMapping,
      mapping('d', { destination: { kind: 'unbound' }, externalRef: 'portfolio:7', mappedSeq: undefined }),
    ];
    const block = encodeMappingBlock(rows)!;
    const decoded = decodeMappingBlock(block);
    expect(decoded).toEqual(rows);
    expect('syncId' in decoded[2]!).toBe(false);
    expect(decoded[1]!.syncId).toBeNull();
    expect(block.destinations).toHaveLength(2); // the repeated destination is written once
  });

  it('regression: a mapping the columns cannot reproduce is written plain, never changed', () => {
    const odd = { ...mapping('x'), futureField: 1 } as ServerMapping;
    expect(encodeMappingBlock([mapping('a'), odd])).toBeUndefined();
  });

  it('regression: a base written with blocks folds to the state it was made from', async () => {
    const store = createMemoryLocalFirstStore(undefined, { partitions: [PARTITION] });
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord<Msg>({ id: 'm1', entityType: 'message', payload: { chatId: 1, n: 5 }, deviceId: 'dev-a' }));
      await tx.put(newLocalRecord<Msg>({ id: 'm2', entityType: 'message', payload: { chatId: 2, n: 6 }, deviceId: 'dev-a' }));
      await tx.putMapping({ destination: BOUND, entityType: 'message', clientEntityId: 'm1', syncId: 10, serverVersion: 2 });
      await tx.putMapping({ destination: BOUND, entityType: 'message', clientEntityId: 'm2', syncId: 11, serverVersion: 2 });
    });
    const view = store.view();
    const bytes = await baseBytes(view);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('"stubBlock"');
    expect(text).toContain('"mappingBlock"');
    expect(text).not.toContain('"stubs"');
    const { latest } = scanJournal(bytes);
    expect(latest?.mappings).toEqual(view.mappings);
    expect(latest?.stubs).toEqual(view.stubs);
    expect(latest?.records).toEqual([]);
  });

  it('regression: an old base without blocks still folds', () => {
    const plain = [mapping('a'), mapping('b', { syncId: 11, serverId: '11', mappedSeq: 2 })];
    const bytes = encodeDeltaFrame({
      reset: true,
      generation: 'g1',
      endsBase: true,
      nextSequence: 3,
      cursors: {},
      mappings: plain,
      stubs: [stub('m1', 1)],
    });
    const { latest } = scanJournal(bytes);
    expect(latest?.mappings).toEqual(plain);
    expect(latest?.stubs).toEqual([stub('m1', 1)]);
  });
});
