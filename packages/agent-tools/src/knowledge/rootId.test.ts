import { describe, expect, it } from 'vitest';
import { folderIdOf, repoIdOfRemote, rootIdFor, rootIdOfSourceRef, rootRelOf, sourcePathOf } from './rootId.js';

describe('rootIdFor — `${host}:${repoId or folder id}:${path}` (PRD 38 §4.2)', () => {
    it('keeps two same-named folders of different repositories apart', () => {
        const a = rootIdFor({ host: 'vscode', repoId: repoIdOfRemote('git@github.com:acme/app.git'), folderId: folderIdOf('file:///home/me/app') });
        const b = rootIdFor({ host: 'vscode', repoId: repoIdOfRemote('https://github.com/other/app'), folderId: folderIdOf('file:///home/you/app') });
        expect(a).toBe('vscode:github.com/acme/app');
        expect(b).toBe('vscode:github.com/other/app');
        expect(a).not.toBe(b);
    });

    it('keeps two same-named folders with no remote apart by their folder id', () => {
        const a = rootIdFor({ host: 'onprem', folderId: folderIdOf('/srv/a/app') });
        const b = rootIdFor({ host: 'onprem', folderId: folderIdOf('/srv/b/app') });
        expect(a).not.toBe(b);
        expect(a).toMatch(/^onprem:f-[0-9a-f]{16}$/);
    });

    it('is stable: the same checkout, however its remote is spelled, is one id', () => {
        const spellings = [
            'git@github.com:acme/app.git',
            'https://github.com/acme/app.git',
            'https://user@GitHub.com:443/acme/app/',
            'ssh://git@github.com/acme/app',
        ];
        const ids = spellings.map((remote) => rootIdFor({ host: 'vscode', repoId: repoIdOfRemote(remote), folderId: 'x' }));
        expect(new Set(ids)).toEqual(new Set(['vscode:github.com/acme/app']));
        expect(folderIdOf('file:///a')).toBe(folderIdOf('file:///a'));
    });

    it('names a folder inside a root, and finds it again', () => {
        const base = rootIdFor({ host: 'vscode', repoId: 'github.com/acme/app', folderId: 'x' });
        const docs = rootIdFor({ host: 'vscode', repoId: 'github.com/acme/app', folderId: 'x', path: './docs/specs/' });
        expect(docs).toBe('vscode:github.com/acme/app:docs/specs');
        expect(rootRelOf(base, docs)).toBe('docs/specs');
        expect(rootRelOf(base, base)).toBe('');
        expect(rootRelOf(base, 'vscode:github.com/acme/application')).toBeUndefined();
    });

    it('treats an empty remote as none', () => {
        expect(repoIdOfRemote('')).toBeUndefined();
        expect(repoIdOfRemote(undefined)).toBeUndefined();
        expect(rootIdFor({ host: 'web', repoId: '', folderId: 'upload:contracts' })).toBe('web:upload:contracts');
    });
});

describe('source refs split unambiguously', () => {
    it('never emits a root id ending in ":" or holding "::"', () => {
        expect(rootIdFor({ host: 'cloud', repoId: 'repo-7:', folderId: 'x' })).toBe('cloud:repo-7');
        expect(rootIdFor({ host: 'web', folderId: 'a::b', path: 'docs/' })).toBe('web:a:b:docs');
    });

    it('reads a source path by its root, whatever the root id looks like', () => {
        expect(sourcePathOf('src:web:folder-1:::docs/a.md', 'web:folder-1:')).toBe('docs/a.md');
        expect(sourcePathOf('src:cloud:r::src/x.ts', 'cloud:r')).toBe('src/x.ts');
        expect(sourcePathOf('src:other::a.md', 'cloud:r')).toBeUndefined();
    });

    it('recovers the root id of a ref built from rootIdFor', () => {
        const root = rootIdFor({ host: 'vscode', repoId: 'github.com/acme/app', folderId: 'f' });
        expect(rootIdOfSourceRef(`src:${root}::src/a.ts`)).toBe(root);
        expect(rootIdOfSourceRef('ent:docs:x')).toBeUndefined();
    });
});
