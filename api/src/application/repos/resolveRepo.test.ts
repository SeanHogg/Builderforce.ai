import { describe, expect, it } from 'vitest';
import { resolveRepoForTask, parseMatchHints } from './resolveRepo';

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
