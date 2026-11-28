import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { LOCALE_ENTRY_ROOTS, middleware } from './middleware';
import { LEGACY_CREATION_ROUTE_PARAM } from '@/lib/canvas/legacyCreationRoute';
import workflowsPage from './app/workflows/page';

describe('legacy Create redirects', () => {
  it.each([
    ['/ide', '/create', 'build'],
    ['/ide/dashboard', '/create', 'build'],
    ['/ide/123/editor', '/create/build/123', null],
  ])('forwards %s with route attribution and the original search', async (source, pathname, filter) => {
    const response = await middleware(new NextRequest(`https://builderforce.ai${source}?project=42`));
    expect(response.status).toBe(307);
    const target = new URL(response.headers.get('location')!);
    expect(target.pathname).toBe(pathname);
    expect(target.searchParams.get('filter')).toBe(filter);
    expect(target.searchParams.get('project')).toBe('42');
    expect(target.searchParams.get(LEGACY_CREATION_ROUTE_PARAM)).toBe('/ide');
  });

  it.each([
    [{ project: ['42', '99'], projectId: '7' }, 42],
    [{ projectId: '7' }, 7],
  ])('forwards the Workflows page with project scope from %o', async (searchParams, projectId) => {
    await expect(workflowsPage({
      searchParams: Promise.resolve({ ...searchParams, filter: 'build' }),
    })).rejects.toMatchObject({
      digest: expect.stringContaining(`/create?filter=workflow&project=${projectId}&_fromCreateRoute=%2Fworkflows`),
    });
  });
});

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
