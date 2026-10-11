import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

function gzipBytes(file: string): number | null {
  if (!existsSync(file)) return null;
  return gzipSync(readFileSync(file)).length;
}

describe('CDN payload budgets', () => {
  it('loader is ≤ 8 KB gzip', () => {
    const n = gzipBytes('dist/loader.js');
    if (n === null) return; // `npm test` without `npm run build`
    expect(n).toBeLessThanOrEqual(8 * 1024);
  });

  it('recorder is ≤ 80 KB gzip (rrweb record included when built)', () => {
    const n = gzipBytes('dist/recorder.js');
    if (n === null) return;
    expect(n).toBeLessThanOrEqual(80 * 1024);
  });
});
