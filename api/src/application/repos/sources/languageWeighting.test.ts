import { describe, it, expect } from 'vitest';
import { deriveLanguagesFromTree, extensionOf } from './languageWeighting';

describe('extensionOf', () => {
  it('returns the lower-case extension without the dot', () => {
    expect(extensionOf('src/app/Main.TS')).toBe('ts');
    expect(extensionOf('a/b/c.tsx')).toBe('tsx');
  });
  it('returns "" for no extension or a dotfile', () => {
    expect(extensionOf('Makefile')).toBe('');
    expect(extensionOf('.gitignore')).toBe(''); // leading dot only → no ext
    expect(extensionOf('dir/README')).toBe('');
  });
});

describe('deriveLanguagesFromTree [1553]', () => {
  it('sums bytes per mapped language', () => {
    const langs = deriveLanguagesFromTree([
      { path: 'src/a.ts', bytes: 100 },
      { path: 'src/b.tsx', bytes: 50 },
      { path: 'src/c.py', bytes: 200 },
    ]);
    expect(langs).toEqual({ TypeScript: 150, Python: 200 });
  });

  it('counts a presence weight of 1 for files with no byte size', () => {
    expect(deriveLanguagesFromTree([{ path: 'x.go' }, { path: 'y.go', bytes: 0 }]))
      .toEqual({ Go: 2 });
  });

  it('ignores unknown extensions and extensionless files', () => {
    expect(deriveLanguagesFromTree([
      { path: 'data.bin', bytes: 9 },
      { path: 'LICENSE', bytes: 9 },
      { path: 'app.rs', bytes: 5 },
    ])).toEqual({ Rust: 5 });
  });

  it('returns {} for an empty tree', () => {
    expect(deriveLanguagesFromTree([])).toEqual({});
  });
});
