import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { WorkspaceFileStore } from './workspaceFileStore';
import { downloadProject, isDownloadableSource, projectArchiveName } from './downloadProject';
import { zipFiles } from '@/lib/zipFiles';

/** A store whose `list()` names files without content, the way the durable one does. */
function memoryStore(initial: Record<string, string>) {
  const read = vi.fn(async (path: string) => {
    const content = initial[path];
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  });
  const store: WorkspaceFileStore = {
    id: 11,
    kind: 'server',
    list: async () => Object.keys(initial).map((path) => ({ path, content: '', type: 'file' as const })),
    read,
    write: async () => {},
    remove: async () => {},
    search: async () => ({ matches: [], truncated: false }),
  };
  return { store, read };
}

describe('isDownloadableSource', () => {
  it('keeps source and drops dependencies and build output at any depth', () => {
    expect(isDownloadableSource('src/App.tsx')).toBe(true);
    expect(isDownloadableSource('package.json')).toBe(true);
    expect(isDownloadableSource('src/build-utils.ts')).toBe(true);
    expect(isDownloadableSource('node_modules/react/index.js')).toBe(false);
    expect(isDownloadableSource('dist/index.html')).toBe(false);
    expect(isDownloadableSource('build/app.js')).toBe(false);
    expect(isDownloadableSource('.next/server/page.js')).toBe(false);
    expect(isDownloadableSource('packages/ui/node_modules/x/y.js')).toBe(false);
    expect(isDownloadableSource('.git/HEAD')).toBe(false);
  });
});

describe('projectArchiveName', () => {
  it('slugs the project name', () => {
    expect(projectArchiveName('My App!')).toBe('my-app.zip');
    expect(projectArchiveName('   ')).toBe('project.zip');
  });
});

describe('downloadProject', () => {
  it('zips the source only and hands the browser one archive', async () => {
    const { store, read } = memoryStore({
      'package.json': '{"name":"app"}',
      'src/App.jsx': 'export default 1;',
      'node_modules/react/index.js': 'r',
      'dist/index.html': '<html></html>',
      '.next/cache.json': '{}',
    });
    const save = vi.fn<(blob: Blob, filename: string) => void>();
    const result = await downloadProject(store, 'Recipe Box', { zip: zipFiles, save });

    expect(result).toEqual({ filename: 'recipe-box.zip', files: 2, unreadable: [] });
    // Excluded paths are filtered BEFORE reading: they never cost a request.
    expect(read.mock.calls.map(([path]) => path).sort()).toEqual(['package.json', 'src/App.jsx']);

    const [blob, filename] = save.mock.calls[0]!;
    expect(filename).toBe('recipe-box.zip');
    expect(blob.type).toBe('application/zip');
    const members = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(members).sort()).toEqual(['package.json', 'src/App.jsx']);
    expect(strFromU8(members['src/App.jsx']!)).toBe('export default 1;');
  });

  it('refuses an empty project rather than saving an empty archive', async () => {
    const save = vi.fn();
    await expect(downloadProject(memoryStore({ 'node_modules/x.js': 'x' }).store, 'x', { zip: zipFiles, save })).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});
