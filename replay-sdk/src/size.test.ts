import { createGzip } from 'node:zlib';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

const dist = join(import.meta.dirname, '..', 'dist');

async function gzipBytes(file: string): Promise<number | null> {
  if (!existsSync(file)) return null;
  let n = 0;
  const sink = new Writable({
    write(chunk, _enc, cb) {
      n += chunk.length;
      cb();
    },
  });
  await pipeline(createReadStream(file), createGzip(), sink);
  return n;
}

describe('CDN payload budgets', () => {
  it('loader is ≤ 2 KB gzip', async () => {
    const n = await gzipBytes(join(dist, 'loader.js'));
    if (n === null) return;
    expect(n).toBeLessThanOrEqual(2 * 1024);
  });

  it('recorder is ≤ 80 KB gzip', async () => {
    const n = await gzipBytes(join(dist, 'recorder.js'));
    if (n === null) return;
    expect(n).toBeLessThanOrEqual(80 * 1024);
  });
});
