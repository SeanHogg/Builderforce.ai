/**
 * `scripts/emit-assets.mjs` is plain node and cannot import the contract, so it
 * keeps its own `HASH_LENGTH`. The API accepts a pinned recorder hash only at the
 * contract's `RECORDER_HASH_LENGTH`; this fails the build if the two ever differ
 * (a pin that can never match was the bug this guards).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECORDER_HASH_LENGTH } from '@builderforce/interaction-contract';

describe('emit-assets recorder hash length', () => {
  it('is the contract’s RECORDER_HASH_LENGTH', () => {
    // The running test file's own path, not `import.meta.url`: under this package's jsdom
    // environment that URL is not a `file:` URL on Windows, and `fileURLToPath` throws.
    const here = path.dirname(expect.getState().testPath!);
    const source = readFileSync(path.resolve(here, '../scripts/emit-assets.mjs'), 'utf8');
    const match = /const HASH_LENGTH = (\d+);/.exec(source);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(RECORDER_HASH_LENGTH);
  });
});
