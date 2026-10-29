import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../domain/shared/hash';
import { recordWrittenHash, type WrittenFileHashes } from './writtenFileHashes';

describe('recordWrittenHash', () => {
  it('records the SHA-256 of the content the run left in the file, replacing an earlier write', async () => {
    const hashes: WrittenFileHashes = new Map();
    await recordWrittenHash(hashes, 'src/a.ts', 'one');
    await recordWrittenHash(hashes, 'src/a.ts', 'two');
    expect(hashes.get('src/a.ts')).toBe(await sha256Hex('two'));
    expect(hashes.size).toBe(1);
  });
});
