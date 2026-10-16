import { describe, expect, it } from 'vitest';
import { readWorkingTree, type TreeFs } from './workingTree';

/** An in-memory fs shaped like LightningFS's promises API. */
function memoryFs(files: Record<string, Uint8Array>): TreeFs {
  const isDir = (path: string) => Object.keys(files).some((f) => f.startsWith(`${path}/`));
  return {
    promises: {
      async readdir(path) {
        const names = new Set<string>();
        for (const f of Object.keys(files)) if (f.startsWith(`${path}/`)) names.add(f.slice(path.length + 1).split('/')[0]!);
        return [...names];
      },
      async stat(path) {
        return { isDirectory: () => isDir(path), size: files[path]?.byteLength ?? 0 };
      },
      async readFile(path) {
        return files[path]!;
      },
    },
  };
}

const text = (s: string) => new TextEncoder().encode(s);

describe('readWorkingTree', () => {
  it('reads source as text and assets as bytes, skipping .git and node_modules', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    const tree = await readWorkingTree(memoryFs({
      '/repo/package.json': text('{}'),
      '/repo/src/App.tsx': text('export {}'),
      '/repo/src/logo.png': png,
      '/repo/.git/HEAD': text('ref: refs/heads/main'),
      '/repo/node_modules/react/index.js': text(''),
    }), '/repo');
    expect(tree.kind).toBe('files');
    if (tree.kind !== 'files') return;
    expect(Object.keys(tree.files).sort()).toEqual(['package.json', 'src/App.tsx', 'src/logo.png']);
    expect(tree.files['src/App.tsx']).toBe('export {}');
    expect(tree.files['src/logo.png']).toBeInstanceOf(Uint8Array);
  });

  it('declines a tree past its limits', async () => {
    const tree = await readWorkingTree(
      memoryFs({ '/repo/a.ts': text('a'), '/repo/b.ts': text('b') }),
      '/repo',
      { maxFiles: 1, maxBytes: 1024, maxFileBytes: 1024 },
    );
    expect(tree.kind).toBe('too-large');
  });
});
