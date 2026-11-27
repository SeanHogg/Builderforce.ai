import { describe, expect, it } from 'vitest';
import { moduleFileCandidates } from '../codeRollup.js';
import { importResolver } from './importResolver.js';

/** AE-G067: a resolver asks the listing once per (importing directory, specifier), however many files import it. */
describe('importResolver memo (6,000-file workspace)', () => {
  const files = new Set<string>();
  for (let d = 0; d < 200; d++) for (let f = 0; f < 30; f++) files.add(`src/m${d}/f${f}.ts`);
  const aliases = { scopes: [{ dir: '', patterns: [{ prefix: '@/', suffix: '', wildcard: true, targets: ['src/*'] }] }] } as never;

  const specs = (f: number): string[] => ['./f0', `./f${f}`, '../m0/f1', '@/m1/f2', 'react'];

  it('resolves the same as without the memo and probes the listing once per distinct key', () => {
    let calls = 0;
    const exists = (p: string): boolean => { calls++; return files.has(p); };
    const resolve = importResolver(exists, aliases);
    const passes: Array<Array<string | undefined>> = [[], []];
    for (const out of passes) {
      for (const from of files) for (const s of specs(Number(/f(\d+)\.ts$/.exec(from)![1]))) out.push(resolve(from, s));
    }
    expect(passes[1]).toEqual(passes[0]);
    // 6,000 files x 5 imports x 2 passes = 60,000 resolutions; distinct keys: 200 dirs x (up to 30 + 4) specifiers.
    expect(calls).toBeLessThan(200 * 40 * 20);
    const fresh = importResolver((p) => files.has(p), aliases);
    expect(fresh('src/m3/f4.ts', './f9')).toBe('src/m3/f9.ts');
    expect(fresh('src/m3/f4.ts', '../m0/f1')).toBe('src/m0/f1.ts');
    expect(fresh('src/m3/f4.ts', '@/m1/f2')).toBe('src/m1/f2.ts');
    expect(fresh('src/m3/f4.ts', 'react')).toBeUndefined();
  });

  it('a new resolver sees a changed listing (the memo lives for one listing)', () => {
    const listing = new Set(['src/a.ts']);
    expect(importResolver((p) => listing.has(p))('src/x.ts', './a')).toBe('src/a.ts');
    listing.delete('src/a.ts');
    expect(importResolver((p) => listing.has(p))('src/x.ts', './a')).toBeUndefined();
  });

  it('moduleFileCandidates is computed once per path and keeps its order', () => {
    const a = moduleFileCandidates('src/a.js');
    expect(moduleFileCandidates('src/a.js')).toBe(a);
    expect(a[0]).toBe('src/a.js');
    expect(a).toContain('src/a.ts');
    expect(a).toContain('src/a/index.tsx');
    expect(new Set(a).size).toBe(a.length);
  });
});
