import { describe, expect, it } from 'vitest';
import { findMatches, searchWorkspace } from './searchWorkspace';

/** Just the R2 surface the workspace store reads. */
function fakeBucket(files: Record<string, string>): R2Bucket {
  return {
    async list({ prefix }: { prefix: string }) {
      return { objects: Object.entries(files).map(([path, body]) => ({ key: `${prefix}${path}`, size: body.length })) };
    },
    async get(key: string) {
      const path = Object.keys(files).find((p) => key.endsWith(`/${p}`));
      return path === undefined ? null : { text: async () => files[path]! };
    },
  } as unknown as R2Bucket;
}

describe('findMatches', () => {
  it('finds every case-insensitive occurrence with 1-based positions', () => {
    const matches = findMatches('a.ts', 'const Todo = 1;\nlet todos = [todo];', 'todo');
    expect(matches.map((m) => [m.line, m.column])).toEqual([[1, 7], [2, 5], [2, 14]]);
  });

  it('trims long lines to a window around the match', () => {
    const line = `${'x'.repeat(200)}needle${'y'.repeat(200)}`;
    const [match] = findMatches('a.ts', line, 'needle');
    expect(match!.preview.startsWith('…')).toBe(true);
    expect(match!.preview.endsWith('…')).toBe(true);
    expect(match!.preview).toContain('needle');
    expect(match!.preview.length).toBeLessThan(line.length);
  });

  it('stops at the limit', () => {
    expect(findMatches('a.ts', 'aa aa aa aa', 'aa', 2)).toHaveLength(2);
  });
});

describe('searchWorkspace', () => {
  it('searches text files and skips binaries', async () => {
    const result = await searchWorkspace(fakeBucket({
      'src/App.tsx': 'export function App() { return <Header />; }',
      'src/Header.tsx': 'export function Header() {}',
      'public/logo.png': 'Header-in-binary',
    }), 7, 'header');
    expect(result.truncated).toBe(false);
    expect(result.matches.map((m) => m.path)).toEqual(['src/App.tsx', 'src/Header.tsx']);
  });

  it('reports truncation when the match cap is reached', async () => {
    const result = await searchWorkspace(fakeBucket({ 'a.txt': 'hit\n'.repeat(500) }), 7, 'hit');
    expect(result.matches).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });
});
