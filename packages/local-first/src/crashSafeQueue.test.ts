import { describe, expect, it } from 'vitest';
import { createCrashSafeQueue, type CrashSafeQueueEntry } from './crashSafeQueue.js';

type Row = CrashSafeQueueEntry<{ id: string; kind?: string; n?: number }>;

function memoryStore(seed: readonly Row[] = []) {
  let rows: readonly Row[] = seed;
  const writes: Row[][] = [];
  return {
    writes,
    read: () => rows,
    write(entries: readonly Row[]) {
      writes.push(entries.slice());
      rows = entries;
    },
  };
}

describe('crash-safe queue', () => {
  it('writes the entry as pending before enqueue returns', () => {
    const seen: string[] = [];
    const store = {
      read: () => [] as Row[],
      write(entries: readonly Row[]) {
        seen.push('write');
        expect(entries).toEqual([{ id: 'work-1', kind: 'ticket', status: 'pending' }]);
      },
    };
    const queue = createCrashSafeQueue(store);
    seen.push('before');
    const written = queue.enqueue({ id: 'work-1', kind: 'ticket' });
    seen.push('after');
    expect(seen).toEqual(['before', 'write', 'after']);
    expect(written).toEqual({ id: 'work-1', kind: 'ticket', status: 'pending' });
  });

  it('does not return when the pending write throws', () => {
    const store = {
      read: () => [] as Row[],
      write() {
        throw new Error('disk full');
      },
    };
    const queue = createCrashSafeQueue(store);
    expect(() => queue.enqueue({ id: 'work-1' })).toThrow('disk full');
    expect(queue.pending()).toEqual([]);
  });

  it('keeps a pending entry in a new queue over the same store after a crash', () => {
    const store = memoryStore();
    const beforeCrash = createCrashSafeQueue(store);
    beforeCrash.enqueue({ id: 'work-1', kind: 'ticket' });

    const recovered = createCrashSafeQueue(store);
    expect(store.read()).toEqual([{ id: 'work-1', kind: 'ticket', status: 'pending' }]);
    expect(store.read().some((entry) => entry.status === 'acked')).toBe(false);
    expect(recovered.pending()).toEqual([{ id: 'work-1', kind: 'ticket', status: 'pending' }]);
    expect(recovered.entries()).toEqual(recovered.pending());
  });

  it('writes an acknowledged entry as acked and drops it from pending', () => {
    const store = memoryStore();
    const queue = createCrashSafeQueue(store);
    queue.enqueue({ id: 'work-1', kind: 'ticket' });
    queue.enqueue({ id: 'work-2', kind: 'audit' });

    queue.acknowledge('work-1');

    expect(store.read()).toEqual([
      { id: 'work-1', kind: 'ticket', status: 'acked' },
      { id: 'work-2', kind: 'audit', status: 'pending' },
    ]);
    const recovered = createCrashSafeQueue(store);
    expect(recovered.pending()).toEqual([{ id: 'work-2', kind: 'audit', status: 'pending' }]);
    expect(recovered.entries().map((entry) => entry.id)).toEqual(['work-1', 'work-2']);
  });

  it('acknowledge of an unknown id does not throw and does not drop other entries', () => {
    const store = memoryStore();
    const queue = createCrashSafeQueue(store);
    queue.enqueue({ id: 'keep', n: 1 });
    queue.enqueue({ id: 'also', n: 2 });
    const before = store.read().map((entry) => ({ ...entry }));
    const writesBefore = store.writes.length;

    expect(() => queue.acknowledge('missing')).not.toThrow();
    expect(() => queue.acknowledge('')).not.toThrow();

    expect(store.read()).toEqual(before);
    expect(store.writes).toHaveLength(writesBefore);
    expect(queue.pending().map((entry) => entry.id)).toEqual(['keep', 'also']);
    expect(queue.entries()).toHaveLength(2);
  });

  it('never mutates the array returned by store.read and writes a new array', () => {
    const held: Row[] = [{ id: 'keep', status: 'pending', n: 1 }];
    Object.freeze(held);
    Object.freeze(held[0]);
    const written: Row[][] = [];
    const store = {
      read: () => held,
      write(entries: readonly Row[]) {
        written.push(entries as Row[]);
      },
    };
    const queue = createCrashSafeQueue(store);

    queue.enqueue({ id: 'new', n: 2 });
    expect(written[0]).not.toBe(held);
    expect(written[0]).toEqual([
      { id: 'keep', status: 'pending', n: 1 },
      { id: 'new', status: 'pending', n: 2 },
    ]);
    expect(held).toEqual([{ id: 'keep', status: 'pending', n: 1 }]);
    expect(held[0].status).toBe('pending');

    queue.acknowledge('keep');
    expect(written[1]).not.toBe(held);
    expect(written[1][0]).toEqual({ id: 'keep', status: 'acked', n: 1 });
    expect(held[0]).toEqual({ id: 'keep', status: 'pending', n: 1 });
    expect(held).toHaveLength(1);

    queue.acknowledge('nope');
    expect(written).toHaveLength(2);
    expect(held).toEqual([{ id: 'keep', status: 'pending', n: 1 }]);
  });

  it('does not alias the caller entry into the written array', () => {
    const store = memoryStore();
    const queue = createCrashSafeQueue(store);
    const entry = { id: 'work-1', n: 1 };
    queue.enqueue(entry);
    entry.n = 99;
    expect(store.read()[0]).toEqual({ id: 'work-1', n: 1, status: 'pending' });
    expect(store.read()).not.toContain(entry);
  });
});
