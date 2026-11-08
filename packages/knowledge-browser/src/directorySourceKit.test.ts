import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytesHash, contentHash, subtleBytesHash, subtleContentHash } from './directorySourceKit';

const sample = (size: number): Uint8Array => Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) & 0xff);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('subtleBytesHash', () => {
  it('equals bytesHash for the same bytes (the page lists with it, the worker re-checks with bytesHash)', async () => {
    for (const bytes of [new Uint8Array(), sample(1), sample(64), sample(70_000)]) {
      const hash = await subtleBytesHash(bytes);
      expect(hash).toBe(bytesHash(bytes));
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('hashes only the view, not the whole buffer it windows', async () => {
    const whole = sample(256);
    const view = whole.subarray(10, 90);
    expect(await subtleBytesHash(view)).toBe(bytesHash(view.slice()));
  });

  it('falls back to bytesHash where there is no SubtleCrypto', async () => {
    vi.stubGlobal('crypto', undefined);
    const bytes = sample(500);
    expect(await subtleBytesHash(bytes)).toBe(bytesHash(bytes));
  });
});

describe('subtleContentHash', () => {
  it('equals contentHash for the same text', async () => {
    for (const text of ['', 'one\r\ntwo\r\n', 'héllo — 日本語 😀']) expect(await subtleContentHash(text)).toBe(contentHash(text));
  });
});
