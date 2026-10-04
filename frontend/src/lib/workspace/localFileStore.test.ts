import { describe, expect, it } from 'vitest';
import { discardLocalWorkspace, localFileStore, localWorkspaceId, readLocalWorkspace, seedLocalWorkspace } from './localFileStore';
import { searchEntries } from './workspaceFileStore';
import { isWorkspaceId } from './workspaceId';

describe('localFileStore', () => {
  it('is addressed by a local workspace id that never collides with a storage project', () => {
    expect(localFileStore('k1').id).toBe('local:k1');
    expect(localWorkspaceId('k1')).toBe('local:k1');
    expect(localFileStore('k1').kind).toBe('local');
    expect(localFileStore('k1').history).toBeUndefined();
  });

  it('seeds an empty workspace once and never over real work', async () => {
    await seedLocalWorkspace('seed', { 'index.html': 'starter' });
    await localFileStore('seed').write('index.html', 'mine');
    await seedLocalWorkspace('seed', { 'index.html': 'starter' });
    expect(await localFileStore('seed').read('index.html')).toBe('mine');
  });

  it('writes, lists in path order, reads, removes and refuses a missing file', async () => {
    const store = localFileStore('crud');
    await store.write('src/b.js', 'b');
    await store.write('a.js', 'a');
    expect((await store.list()).map((entry) => entry.path)).toEqual(['a.js', 'src/b.js']);
    expect(await store.read('src/b.js')).toBe('b');
    await store.remove('a.js');
    await expect(store.read('a.js')).rejects.toThrow('a.js');
  });

  it('searches its own files with the server search contract', async () => {
    const store = localFileStore('search');
    await store.write('src/App.jsx', 'const Title = 1;\nexport default Title;');
    expect(await store.search('title')).toEqual({
      matches: [
        { path: 'src/App.jsx', line: 1, column: 7, preview: 'const Title = 1;' },
        { path: 'src/App.jsx', line: 2, column: 16, preview: 'export default Title;' },
      ],
      truncated: false,
    });
  });

  it('hands every file over and forgets them once discarded', async () => {
    await localFileStore('gone').write('a.js', '1');
    expect(await readLocalWorkspace('gone')).toEqual({ 'a.js': '1' });
    await discardLocalWorkspace('gone');
    expect(await readLocalWorkspace('gone')).toEqual({});
  });
});

describe('searchEntries', () => {
  it('finds nothing for an empty query', () => {
    expect(searchEntries([{ path: 'a', content: 'x' }], '')).toEqual({ matches: [], truncated: false });
  });
});

describe('isWorkspaceId', () => {
  it('accepts a positive storage id or a local key, nothing else', () => {
    expect(isWorkspaceId(12)).toBe(true);
    expect(isWorkspaceId('local:abc')).toBe(true);
    expect(isWorkspaceId(0)).toBe(false);
    expect(isWorkspaceId(1.5)).toBe(false);
    expect(isWorkspaceId('local:')).toBe(false);
    expect(isWorkspaceId('12')).toBe(false);
  });
});
