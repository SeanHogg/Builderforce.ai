import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentHash as memoryContentHash } from '@seanhogg/builderforce-memory/knowledge';
import { bytesHash, textContentHash as contentHash, subtleBytesHash, subtleContentHash } from './directorySourceKit';

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

describe('one content hash (PRD 41 §B2)', () => {
  it('textContentHash and bytesHash are memory contentHash: CRLF, lone CR and LF text agree, binary bytes hash raw', async () => {
    const enc = (text: string) => new TextEncoder().encode(text);
    expect(contentHash('one\r\ntwo\rthree\n')).toBe(memoryContentHash(enc('one\ntwo\nthree\n')));
    expect(contentHash('one\r\ntwo\r\n')).toBe(contentHash('one\ntwo\n'));
    const binary = new Uint8Array([0x41, 0x0d, 0x0a, 0x00, 0x0d]);
    expect(bytesHash(binary)).toBe(memoryContentHash(binary));
    expect(await subtleBytesHash(binary)).toBe(memoryContentHash(binary));
    expect(await subtleBytesHash(enc('a\r\nb'))).toBe(memoryContentHash(enc('a\nb')));
  });
});

describe('subtleContentHash', () => {
  it('equals contentHash for the same text', async () => {
    for (const text of ['', 'one\r\ntwo\r\n', 'héllo — 日本語 😀']) expect(await subtleContentHash(text)).toBe(contentHash(text));
  });
});
