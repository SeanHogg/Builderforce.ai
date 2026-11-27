import { describe, expect, it } from 'vitest';
import { extractFromSymbols, extractFromSymbolsYielding, type SymbolFile } from './seedCode.js';

/** AE-G067: the knowledge seed releases the event loop while it extracts thousands of files, and builds the same cards. */
describe('extractFromSymbolsYielding', () => {
  const files: SymbolFile[] = Array.from({ length: 6000 }, (_, i) => ({
    path: `src/m${i % 50}/f${i}.ts`,
    symbols: [{ name: `fn${i}`, kind: 'function', exported: true, line: 1 } as never],
  }));

  it('equals the synchronous extract and yields between slices', async () => {
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 0);
    const got = await extractFromSymbolsYielding('r', files);
    clearInterval(timer);
    expect(got).toEqual(extractFromSymbols('r', files));
    expect(got!.length).toBe(6000);
    // It yields between slices: an interval timer got at least one turn while 6,000 files were extracted. A per-slice
    // count is not asserted, since timer scheduling on a loaded CI machine makes it flaky.
    expect(ticks).toBeGreaterThan(0);
  });

  it('abandons the work when aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    expect(await extractFromSymbolsYielding('r', files, undefined, ctl.signal)).toBeNull();
  });
});
