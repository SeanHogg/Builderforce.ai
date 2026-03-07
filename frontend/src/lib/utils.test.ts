import { describe, it, expect } from 'vitest';
import { getLanguage, getFileName, buildTree } from './utils';
import type { FileEntry } from './utils';

// ---------------------------------------------------------------------------
// getLanguage
// ---------------------------------------------------------------------------

describe('getLanguage', () => {
  it('returns plaintext when no path is given', () => {
    expect(getLanguage()).toBe('plaintext');
    expect(getLanguage(undefined)).toBe('plaintext');
  });

  it('returns plaintext for unknown extensions', () => {
    expect(getLanguage('file.xyz')).toBe('plaintext');
    expect(getLanguage('README')).toBe('plaintext');
  });

  it('maps TypeScript extensions correctly', () => {
    expect(getLanguage('index.ts')).toBe('typescript');
    expect(getLanguage('app.tsx')).toBe('typescriptreact');
  });

  it('maps JavaScript extensions correctly', () => {
    expect(getLanguage('main.js')).toBe('javascript');
    expect(getLanguage('App.jsx')).toBe('javascriptreact');
  });

  it('maps web extensions correctly', () => {
    expect(getLanguage('styles.css')).toBe('css');
    expect(getLanguage('styles.scss')).toBe('scss');
    expect(getLanguage('index.html')).toBe('html');
    expect(getLanguage('data.json')).toBe('json');
  });

  it('maps documentation and config extensions', () => {
    expect(getLanguage('README.md')).toBe('markdown');
    expect(getLanguage('config.yaml')).toBe('yaml');
    expect(getLanguage('config.yml')).toBe('yaml');
    expect(getLanguage('config.toml')).toBe('toml');
    expect(getLanguage('schema.sql')).toBe('sql');
  });

  it('maps backend language extensions', () => {
    expect(getLanguage('main.py')).toBe('python');
    expect(getLanguage('main.rs')).toBe('rust');
    expect(getLanguage('main.go')).toBe('go');
    expect(getLanguage('Main.java')).toBe('java');
    expect(getLanguage('deploy.sh')).toBe('shell');
  });

  it('is case-insensitive for extensions', () => {
    expect(getLanguage('index.TS')).toBe('typescript');
    expect(getLanguage('App.TSX')).toBe('typescriptreact');
    expect(getLanguage('main.JS')).toBe('javascript');
  });

  it('handles paths with multiple dots', () => {
    expect(getLanguage('src/lib/my.module.ts')).toBe('typescript');
    expect(getLanguage('test.config.json')).toBe('json');
  });
});

// ---------------------------------------------------------------------------
// getFileName
// ---------------------------------------------------------------------------

describe('getFileName', () => {
  it('returns the base filename from a path', () => {
    expect(getFileName('src/lib/utils.ts')).toBe('utils.ts');
    expect(getFileName('src/components/IDE.tsx')).toBe('IDE.tsx');
  });

  it('returns the string itself when there is no separator', () => {
    expect(getFileName('index.ts')).toBe('index.ts');
    expect(getFileName('README')).toBe('README');
  });

  it('handles deeply nested paths', () => {
    expect(getFileName('a/b/c/d/file.json')).toBe('file.json');
  });

  it('handles a trailing slash gracefully', () => {
    // path.split('/').pop() returns '' for trailing slash; fallback returns original
    expect(getFileName('src/')).toBe('src/');
  });

  it('handles empty string', () => {
    expect(getFileName('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildTree
// ---------------------------------------------------------------------------

const file = (path: string): FileEntry => ({ path, content: '', type: 'file' });
const dir = (path: string): FileEntry => ({ path, content: '', type: 'directory' });

describe('buildTree', () => {
  it('returns an empty array for no files', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('builds a flat list of root-level files', () => {
    const tree = buildTree([file('index.ts'), file('package.json')]);
    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe('index.ts');
    expect(tree[0].type).toBe('file');
    expect(tree[1].name).toBe('package.json');
  });

  it('creates intermediate directory nodes automatically', () => {
    const tree = buildTree([file('src/main.ts')]);
    expect(tree).toHaveLength(1);
    const srcDir = tree[0];
    expect(srcDir.name).toBe('src');
    expect(srcDir.type).toBe('directory');
    expect(srcDir.children).toHaveLength(1);
    expect(srcDir.children![0].name).toBe('main.ts');
    expect(srcDir.children![0].type).toBe('file');
  });

  it('groups sibling files under the same directory node', () => {
    const tree = buildTree([file('src/a.ts'), file('src/b.ts')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(2);
  });

  it('handles multiple top-level directories', () => {
    const tree = buildTree([file('src/a.ts'), file('tests/a.test.ts')]);
    expect(tree).toHaveLength(2);
    expect(tree.map(n => n.name)).toContain('src');
    expect(tree.map(n => n.name)).toContain('tests');
  });

  it('handles deeply nested files', () => {
    const tree = buildTree([file('a/b/c/d.ts')]);
    const a = tree[0];
    const b = a.children![0];
    const c = b.children![0];
    const d = c.children![0];
    expect(a.name).toBe('a');
    expect(b.name).toBe('b');
    expect(c.name).toBe('c');
    expect(d.name).toBe('d.ts');
    expect(d.type).toBe('file');
    expect(d.children).toBeUndefined();
  });

  it('preserves explicit directory entries', () => {
    const tree = buildTree([dir('src'), file('src/index.ts')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('src');
    expect(tree[0].type).toBe('directory');
  });

  it('does not duplicate directory nodes shared by multiple files', () => {
    const tree = buildTree([
      file('src/components/A.tsx'),
      file('src/components/B.tsx'),
      file('src/lib/utils.ts'),
    ]);
    expect(tree).toHaveLength(1); // only 'src'
    const src = tree[0];
    expect(src.children).toHaveLength(2); // 'components' and 'lib'
  });

  it('leaf file nodes have no children array', () => {
    const tree = buildTree([file('index.ts')]);
    expect(tree[0].children).toBeUndefined();
  });
});
