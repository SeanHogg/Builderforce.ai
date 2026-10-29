import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../domain/shared/hash';
import { recordWrittenHash, seedWrittenHashes, snapshotWrittenHashes, type WrittenFileHashes } from './writtenFileHashes';

describe('recordWrittenHash', () => {
  it('records the SHA-256 of the content the run left in the file, replacing an earlier write', async () => {
    const hashes: WrittenFileHashes = new Map();
    await recordWrittenHash(hashes, 'src/a.ts', 'one');
    await recordWrittenHash(hashes, 'src/a.ts', 'two');
    expect(hashes.get('src/a.ts')).toBe(await sha256Hex('two'));
    expect(hashes.size).toBe(1);
  });
});

describe('a durable run’s hashes across ticks', () => {
  it('survives the JSON round trip of CloudLoopState: tick 1’s files are still hashed on tick 2', async () => {
    const tick1: WrittenFileHashes = seedWrittenHashes(undefined);
    expect(tick1.size).toBe(0);
    await recordWrittenHash(tick1, 'src/a.ts', 'one');
    await recordWrittenHash(tick1, 'src/b.ts', 'two');

    const persisted = JSON.parse(JSON.stringify({ writtenHashes: snapshotWrittenHashes(tick1) })) as { writtenHashes: Record<string, string> };
    const tick2 = seedWrittenHashes(persisted.writtenHashes);
    expect(Object.fromEntries(tick2)).toEqual({ 'src/a.ts': await sha256Hex('one'), 'src/b.ts': await sha256Hex('two') });

    // Tick 2 rewrites one and deletes the other; the next snapshot carries exactly that.
    await recordWrittenHash(tick2, 'src/a.ts', 'three');
    tick2.delete('src/b.ts');
    expect(snapshotWrittenHashes(tick2)).toEqual({ 'src/a.ts': await sha256Hex('three') });
  });

  it('seeds an empty map from a state saved before hashes were persisted', () => {
    expect(seedWrittenHashes(undefined).size).toBe(0);
    expect(seedWrittenHashes(null).size).toBe(0);
  });

  it('seeds a copy: the persisted record is not mutated by the live run', async () => {
    const persisted = { 'src/a.ts': 'h' };
    const live = seedWrittenHashes(persisted);
    await recordWrittenHash(live, 'src/b.ts', 'x');
    expect(persisted).toEqual({ 'src/a.ts': 'h' });
  });
});
