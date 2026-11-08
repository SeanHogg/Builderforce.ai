import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALE_ENTRY_ROOTS } from './middleware';

/**
 * `LOCALE_ENTRY_ROOTS` (middleware) and `run_worker_first` (wrangler.toml) must name the
 * same marketing entry pages: a root missing from the wrangler list is answered by the
 * assets layer and never reaches middleware, so it silently loses locale detection.
 */
describe('locale entry roots vs wrangler run_worker_first', () => {
  const toml = readFileSync(join(__dirname, '..', 'wrangler.toml'), 'utf8');
  const list = /run_worker_first\s*=\s*\[([\s\S]*?)\n\]/.exec(toml)?.[1] ?? '';
  const patterns = [...list.replace(/^\s*#.*$/gm, '').matchAll(/"([^"]+)"/g)].map((m) => m[1]!);

  it('lists every locale entry root explicitly', () => {
    for (const root of LOCALE_ENTRY_ROOTS) expect(patterns, root).toContain(`/${root}`);
  });

  it('lists no root-level path that is not a locale entry root', () => {
    const roots = patterns
      .filter((p) => !p.startsWith('!') && p !== '/' && !p.endsWith('/*'))
      .map((p) => p.slice(1))
      .sort();
    expect(roots).toEqual([...LOCALE_ENTRY_ROOTS].sort());
  });

  it('adds children for /blog and /compare only', () => {
    const children = patterns.filter((p) => p.endsWith('/*') && !p.startsWith('!')).sort();
    expect(children).toEqual(['/blog/*', '/compare/*']);
  });
});
