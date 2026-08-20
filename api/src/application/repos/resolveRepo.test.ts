import { describe, expect, it } from 'vitest';
import { resolveRepoForTask, parseMatchHints, routeWritePathToRepo, pathGlobMatches } from './resolveRepo';

const hints = (h: { labels?: string[]; keywords?: string[]; pathGlobs?: string[] }) => JSON.stringify(h);

describe('parseMatchHints', () => {
  it('returns empty arrays for null / blank / invalid JSON', () => {
    expect(parseMatchHints(null)).toEqual({ labels: [], keywords: [], pathGlobs: [] });
    expect(parseMatchHints('')).toEqual({ labels: [], keywords: [], pathGlobs: [] });
    expect(parseMatchHints('not json')).toEqual({ labels: [], keywords: [], pathGlobs: [] });
    expect(parseMatchHints('[1,2,3]')).toEqual({ labels: [], keywords: [], pathGlobs: [] });
  });

  it('lower-cases labels/keywords and filters non-strings', () => {
    const out = parseMatchHints(JSON.stringify({ labels: ['Frontend', 1, ''], keywords: ['API'], pathGlobs: ['src/**'] }));
    expect(out.labels).toEqual(['frontend']);
    expect(out.keywords).toEqual(['api']);
    expect(out.pathGlobs).toEqual(['src/**']);
  });
});

describe('resolveRepoForTask precedence', () => {
  it('returns null for empty repo list', () => {
    expect(resolveRepoForTask({}, [])).toBeNull();
  });

  it('explicit wins over hints and default', () => {
    const repos = [
      { id: 'a', isDefault: true, matchHints: hints({ labels: ['frontend'] }) },
      { id: 'b', matchHints: hints({ labels: ['frontend'] }) },
    ];
    const res = resolveRepoForTask({ explicitRepoId: 'b', labels: ['frontend'] }, repos);
    expect(res).toEqual({ repoId: 'b', method: 'explicit' });
  });

  it('explicit but unknown repo id fails closed (null)', () => {
    const repos = [{ id: 'a', isDefault: true }];
    expect(resolveRepoForTask({ explicitRepoId: 'zzz' }, repos)).toBeNull();
  });

  it('inferred by label match', () => {
    const repos = [
      { id: 'frontend', matchHints: hints({ labels: ['ui', 'frontend'] }) },
      { id: 'backend', matchHints: hints({ labels: ['api'] }) },
    ];
    const res = resolveRepoForTask({ labels: ['FrontEnd'] }, repos);
    expect(res).toEqual({ repoId: 'frontend', method: 'inferred' });
  });

  it('inferred by description keyword', () => {
    const repos = [
      { id: 'frontend', matchHints: hints({ keywords: ['react'] }) },
      { id: 'backend', matchHints: hints({ keywords: ['postgres'] }) },
    ];
    const res = resolveRepoForTask({ description: 'Fix the React component layout' }, repos);
    expect(res).toEqual({ repoId: 'frontend', method: 'inferred' });
  });

  it('inferred by path glob in description (** crosses separators)', () => {
    const repos = [
      { id: 'frontend', matchHints: hints({ pathGlobs: ['src/web/**'] }) },
      { id: 'backend', matchHints: hints({ pathGlobs: ['src/api/**'] }) },
    ];
    const res = resolveRepoForTask({ description: 'Touches src/web/components/Button.tsx' }, repos);
    expect(res).toEqual({ repoId: 'frontend', method: 'inferred' });
  });

  it('single * does not cross path separators', () => {
    const repos = [{ id: 'r1', matchHints: hints({ pathGlobs: ['src/*.ts'] }) }];
    // src/a/b.ts has a separator after src/, so single-* must NOT match → falls to no-match.
    expect(resolveRepoForTask({ description: 'path src/a/b.ts here' }, repos)).toBeNull();
    // src/x.ts matches.
    expect(resolveRepoForTask({ description: 'path src/x.ts here' }, repos)).toEqual({
      repoId: 'r1',
      method: 'inferred',
    });
  });

  it('falls back to default when nothing is inferred', () => {
    const repos = [
      { id: 'a', isDefault: true, matchHints: hints({ labels: ['frontend'] }) },
      { id: 'b', matchHints: hints({ labels: ['backend'] }) },
    ];
    const res = resolveRepoForTask({ labels: ['unrelated'] }, repos);
    expect(res).toEqual({ repoId: 'a', method: 'default' });
  });

  it('ambiguous inference (two repos match) fails closed', () => {
    const repos = [
      { id: 'a', matchHints: hints({ keywords: ['shared'] }) },
      { id: 'b', matchHints: hints({ keywords: ['shared'] }) },
    ];
    expect(resolveRepoForTask({ description: 'a shared change' }, repos)).toBeNull();
  });

  it('ambiguous inference resolves when exactly one match is the default', () => {
    const repos = [
      { id: 'a', isDefault: true, matchHints: hints({ keywords: ['shared'] }) },
      { id: 'b', matchHints: hints({ keywords: ['shared'] }) },
    ];
    expect(resolveRepoForTask({ description: 'a shared change' }, repos)).toEqual({
      repoId: 'a',
      method: 'inferred',
    });
  });

  it('no match and no default fails closed', () => {
    const repos = [
      { id: 'a', matchHints: hints({ labels: ['frontend'] }) },
      { id: 'b', matchHints: hints({ labels: ['backend'] }) },
    ];
    expect(resolveRepoForTask({ labels: ['nope'] }, repos)).toBeNull();
  });

  it('multiple defaults are ambiguous → fails closed', () => {
    const repos = [
      { id: 'a', isDefault: true },
      { id: 'b', isDefault: true },
    ];
    expect(resolveRepoForTask({}, repos)).toBeNull();
  });

  it('single repo with no hints and no default still fails closed', () => {
    const repos = [{ id: 'only' }];
    expect(resolveRepoForTask({ description: 'whatever' }, repos)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multi-repo spanning (0956): routing ONE file write to ONE repo in a task's set
// ---------------------------------------------------------------------------

describe('pathGlobMatches', () => {
  it('anchors a directory glob so a nested lookalike is not claimed', () => {
    expect(pathGlobMatches('api/**', 'api/src/x.ts')).toBe(true);
    expect(pathGlobMatches('api/**', 'frontend/api/x.ts')).toBe(false);
  });

  it('treats a bare directory name as that directory', () => {
    expect(pathGlobMatches('frontend', 'frontend/src/App.tsx')).toBe(true);
    expect(pathGlobMatches('frontend', 'api/src/App.tsx')).toBe(false);
  });

  it('matches a bare suffix glob at any depth', () => {
    expect(pathGlobMatches('*.md', 'README.md')).toBe(true);
    expect(pathGlobMatches('*.md', 'docs/guide/intro.md')).toBe(true);
    expect(pathGlobMatches('*.md', 'docs/guide/intro.mdx')).toBe(false);
  });

  it('single * does not cross a path separator', () => {
    expect(pathGlobMatches('src/*.ts', 'src/a.ts')).toBe(true);
    expect(pathGlobMatches('src/*.ts', 'src/deep/a.ts')).toBe(false);
  });
});

describe('routeWritePathToRepo', () => {
  const set = [
    { id: 'api', isPrimary: true, matchHints: hints({ pathGlobs: ['api/**'] }) },
    { id: 'web', matchHints: hints({ pathGlobs: ['frontend/**', '*.md'] }) },
  ];

  it('routes each write to the repo whose pathGlob claims it', () => {
    expect(routeWritePathToRepo('api/src/routes/x.ts', set)).toEqual({
      repoId: 'api', method: 'glob', glob: 'api/**',
    });
    expect(routeWritePathToRepo('frontend/src/App.tsx', set)).toEqual({
      repoId: 'web', method: 'glob', glob: 'frontend/**',
    });
    expect(routeWritePathToRepo('README.md', set)).toEqual({
      repoId: 'web', method: 'glob', glob: '*.md',
    });
  });

  it('falls back to the primary when nothing claims the path — a write is never dropped', () => {
    expect(routeWritePathToRepo('scripts/tool.sh', set)).toEqual({ repoId: 'api', method: 'primary' });
    expect(routeWritePathToRepo('', set)).toEqual({ repoId: 'api', method: 'primary' });
  });

  it('the MOST SPECIFIC glob wins when two repos both match', () => {
    const overlapping = [
      { id: 'mono', isPrimary: true, matchHints: hints({ pathGlobs: ['**'] }) },
      { id: 'ui', matchHints: hints({ pathGlobs: ['frontend/src/**'] }) },
    ];
    expect(routeWritePathToRepo('frontend/src/App.tsx', overlapping)?.repoId).toBe('ui');
    expect(routeWritePathToRepo('server/main.go', overlapping)?.repoId).toBe('mono');
  });

  it('an equally specific tie breaks toward the primary, deterministically', () => {
    const tied = [
      { id: 'b', matchHints: hints({ pathGlobs: ['shared/**'] }) },
      { id: 'a', isPrimary: true, matchHints: hints({ pathGlobs: ['shared/**'] }) },
    ];
    expect(routeWritePathToRepo('shared/util.ts', tied)?.repoId).toBe('a');
    expect(routeWritePathToRepo('shared/util.ts', tied)?.repoId).toBe('a');
  });

  // The single-repo case must be untouched by 0956: one candidate, no hints,
  // every path goes there.
  it('a single-repo set routes everything to that repo', () => {
    const one = [{ id: 'only', isPrimary: true }];
    expect(routeWritePathToRepo('anything/at/all.ts', one)).toEqual({ repoId: 'only', method: 'primary' });
  });

  it('returns null for an empty set', () => {
    expect(routeWritePathToRepo('a.ts', [])).toBeNull();
  });
});
