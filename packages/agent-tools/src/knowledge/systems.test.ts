/**
 * knowledge/systems.test.ts — systems, apps and duplicate copies of a review root (PRD 41 A9).
 */

import { describe, expect, it } from 'vitest';
import { detectSystems, duplicateCopies, manifestProjectName, type DetectedSystem } from './systems.js';
import { strideSample } from './systemCopies.js';

const reader = (files: Record<string, string>) => async (p: string) => files[p];
const pkg = (name: string, extra: Record<string, unknown> = {}) => JSON.stringify({ name, ...extra });

describe('detectSystems', () => {
    it('a root that is itself a repository is one system named after its folder', async () => {
        const d = await detectSystems(
            { rootName: 'proj', paths: ['.git/HEAD', 'package.json', 'src/a.ts', 'sub/package.json'], gitRoots: [''] },
            reader({ 'package.json': pkg('proj') }),
        );
        expect(d.systems.map((s) => [s.path, s.name, s.hasGit])).toEqual([['', 'proj', true]]);
        expect(d.systemOf('src/a.ts')).toBe('');
    });

    it('a plain folder of repositories is several systems; a .git FILE counts', async () => {
        const d = await detectSystems(
            { rootName: 'agentic', paths: ['one/.git/HEAD', 'one/a.ts', 'two/.git', 'two/b.ts', 'loose/package.json', 'loose/c.ts'] },
            reader({ 'loose/package.json': pkg('loose-thing') }),
        );
        expect(d.systems.map((s) => [s.path, s.hasGit])).toEqual([['loose', false], ['one', true], ['two', true]]);
        expect(d.systemOf('one/a.ts')).toBe('one');
        expect(d.systemOf('two/deep/b.ts')).toBe('two');
        expect(d.systemOf('readme.md')).toBeUndefined();
    });

    it('takes the topmost manifest folder, and ignores a manifest with no name', async () => {
        const d = await detectSystems(
            { rootName: 'r', paths: ['a/package.json', 'a/inner/package.json', 'b/package.json', 'b/Cargo.toml', 'c/go.mod', 'd/pyproject.toml'] },
            reader({
                'a/package.json': pkg('a'), 'a/inner/package.json': pkg('inner'), 'b/package.json': '{}',
                'b/Cargo.toml': '[package]\nname = "bee"\n', 'c/go.mod': 'module example.com/c\n', 'd/pyproject.toml': '[project]\nname = "dee"\n',
            }),
        );
        expect(d.systems.map((s) => [s.path, s.manifestName])).toEqual([
            ['a', 'a'], ['b', 'bee'], ['c', 'example.com/c'], ['d', 'dee'],
        ]);
    });

    it('a folder holding a repository is not itself a system', async () => {
        const d = await detectSystems(
            { rootName: 'r', paths: ['package.json', 'x/.git/HEAD', 'x/a.ts'] },
            reader({ 'package.json': pkg('top') }),
        );
        expect(d.systems.map((s) => s.path)).toEqual(['x']);
    });

    it('no repository and no manifest is one system at the root', async () => {
        const d = await detectSystems({ rootName: 'docs', paths: ['a.md'] }, reader({}));
        expect(d.systems).toEqual([{ path: '', name: 'docs', hasGit: false, apps: [] }]);
    });

    it('workspace packages are apps (package.json workspaces and pnpm-workspace.yaml)', async () => {
        const d = await detectSystems(
            {
                rootName: 'r',
                paths: ['m/.git/HEAD', 'm/package.json', 'm/pnpm-workspace.yaml', 'm/packages/web/package.json', 'm/packages/api/package.json', 'm/packages/web/src/x.ts', 'm/tools/cli/package.json', 'm/other/package.json'],
            },
            reader({
                'm/package.json': pkg('m', { workspaces: ['tools/*'] }),
                'm/pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - '!packages/api'\n",
                'm/packages/web/package.json': pkg('@m/web'), 'm/packages/api/package.json': pkg('@m/api'), 'm/tools/cli/package.json': pkg('cli'),
            }),
        );
        expect(d.systems[0]!.apps).toEqual([{ path: 'm/packages/web', name: '@m/web' }, { path: 'm/tools/cli', name: 'cli' }]);
    });

    it('is deterministic whatever the listing order', async () => {
        const paths = ['b/.git/HEAD', 'a/.git/HEAD', 'c/package.json'];
        const files = { 'c/package.json': pkg('c') };
        const x = await detectSystems({ rootName: 'r', paths }, reader(files));
        const y = await detectSystems({ rootName: 'r', paths: [...paths].reverse() }, reader(files));
        expect(x.systems).toEqual(y.systems);
    });
});

describe('manifestProjectName', () => {
    it('reads each manifest kind', () => {
        expect(manifestProjectName('package.json', '{"name":"p"}')).toBe('p');
        expect(manifestProjectName('package.json', '{')).toBeUndefined();
        expect(manifestProjectName('Cargo.toml', '[workspace]\nmembers=[]')).toBe('workspace');
        expect(manifestProjectName('pyproject.toml', '[tool.poetry]\nname="q"')).toBe('q');
    });
});

describe('duplicateCopies', () => {
    const sys = (path: string, extra: Partial<DetectedSystem> = {}): DetectedSystem => ({
        path, name: path, hasGit: false, manifestName: 'proj', apps: [], ...extra,
    });
    const tree = (folder: string, n: number, edit = 0): Array<[string, string]> =>
        Array.from({ length: n }, (_, i) => [`${folder}/src/f${String(i).padStart(3, '0')}.ts`, i < edit ? `${folder}-changed` : `h${i}`]);
    const hashes = (...parts: Array<Array<[string, string]>>) => new Map(parts.flat());

    it('the copy is the one without .git', () => {
        const out = duplicateCopies([sys('copy'), sys('orig', { hasGit: true })], hashes(tree('copy', 50), tree('orig', 50)));
        expect(out).toEqual([{ copy: 'copy', original: 'orig', similarity: 1, reason: 'no-git' }]);
    });

    it('both with git: the folder whose name differs from the manifest name is the copy', () => {
        const out = duplicateCopies(
            [sys('proj', { hasGit: true }), sys('proj-old', { hasGit: true })],
            hashes(tree('proj', 20), tree('proj-old', 20)),
        );
        expect(out).toEqual([{ copy: 'proj-old', original: 'proj', similarity: 1, reason: 'name-mismatch' }]);
    });

    it('otherwise the later name is the copy', () => {
        const out = duplicateCopies(
            [sys('a', { manifestName: 'x' }), sys('b', { manifestName: 'x' })],
            hashes(tree('a', 20), tree('b', 20)),
        );
        expect(out).toEqual([{ copy: 'b', original: 'a', similarity: 1, reason: 'later-name' }]);
    });

    it('needs 90% of the sample to match', () => {
        const systems = [sys('copy'), sys('orig', { hasGit: true })];
        expect(duplicateCopies(systems, hashes(tree('copy', 100, 9), tree('orig', 100)))).toHaveLength(1);
        expect(duplicateCopies(systems, hashes(tree('copy', 100, 11), tree('orig', 100)))).toEqual([]);
    });

    it('samples at most 200 files, by sorted path', () => {
        const out = duplicateCopies([sys('copy'), sys('orig', { hasGit: true })], hashes(tree('copy', 300), tree('orig', 300)));
        expect(out[0]!.similarity).toBe(1);
    });

    it('different projects are never copies, and two same-named tiny folders prove nothing', () => {
        expect(duplicateCopies([sys('a', { manifestName: 'x' }), sys('b', { manifestName: 'y' })], hashes(tree('a', 20), tree('b', 20)))).toEqual([]);
        expect(duplicateCopies([sys('a'), sys('b')], hashes(tree('a', 2), tree('b', 2)))).toEqual([]);
    });

    it('two copies of one original both point at it', () => {
        const out = duplicateCopies(
            [sys('o', { hasGit: true }), sys('c1'), sys('c2')],
            hashes(tree('o', 20), tree('c1', 20), tree('c2', 20)),
        );
        expect(out.map((c) => [c.copy, c.original])).toEqual([['c1', 'o'], ['c2', 'o']]);
    });

    it('samples at most 200 files as a stride across the WHOLE sorted list, not its first 200', () => {
        // The last 200 of 400 differ: a first-200 sample would call these identical.
        const edited = tree('copy', 400).map(([p, h], i): [string, string] => [p, i >= 200 ? `${h}-edited` : h]);
        expect(duplicateCopies([sys('copy'), sys('orig', { hasGit: true })], hashes(edited, tree('orig', 400)))).toEqual([]);
        expect(strideSample(Array.from({ length: 1000 }, (_, i) => i), 4)).toEqual([0, 250, 500, 750]);
        expect(strideSample([1, 2, 3], 200)).toEqual([1, 2, 3]);
    });

    it('a git system with no manifest name matches by folder name', () => {
        const out = duplicateCopies(
            [{ path: 'proj', name: 'proj', hasGit: true, apps: [] }, sys('proj-copy', { manifestName: 'proj' })],
            hashes(tree('proj', 20), tree('proj-copy', 20)),
        );
        expect(out).toEqual([{ copy: 'proj-copy', original: 'proj', similarity: 1, reason: 'no-git' }]);
    });
});

describe('detectSystems — a loose copy of a repository with no root manifest', () => {
    // The shape of c:/code/agentic: a repo with NO root manifest, a loose copy of it (no .git) whose
    // manifests all sit in sub-folders, and another repository.
    const files = (folder: string, n: number, salt = 'h'): Array<[string, string]> => Array.from({ length: n }, (_, i) => [`${folder}/src/f${String(i).padStart(3, '0')}.ts`, `${salt}${i}`]);
    const manifests = { 'bf-verify-fdc/frontend/package.json': pkg('builderforce-frontend'), 'bf-verify-fdc/api/package.json': pkg('builderforce-api'), 'memory/package.json': pkg('memory') };
    const listing = (extra: Array<[string, string]> = []) => {
        const hashed = new Map<string, string>([...files('Builderforce.ai', 30), ...files('bf-verify-fdc', 30), ...files('memory', 30, 'm'), ...extra]);
        const paths = [...hashed.keys(), 'Builderforce.ai/.git/HEAD', 'memory/.git/HEAD', ...Object.keys(manifests)];
        return { rootName: 'agentic', paths, hashes: hashed };
    };

    it('is ONE system marked a copy, not split into its manifests', async () => {
        const d = await detectSystems(listing(), reader(manifests));
        expect(d.systems.map((s) => s.path)).toEqual(['Builderforce.ai', 'bf-verify-fdc', 'memory']);
        expect(d.systems.find((s) => s.path === 'bf-verify-fdc')).toMatchObject({ hasGit: false, copy: { original: 'Builderforce.ai', similarity: 1 } });
        expect(d.systemOf('bf-verify-fdc/frontend/src/a.ts')).toBe('bf-verify-fdc');
        expect(duplicateCopies(d.systems, listing().hashes)).toEqual([{ copy: 'bf-verify-fdc', original: 'Builderforce.ai', similarity: 1, reason: 'no-git' }]);
    });

    it('without hashes the folder is split by its manifests (nothing proves it a copy)', async () => {
        const { hashes: _h, ...bare } = listing();
        const d = await detectSystems(bare, reader(manifests));
        expect(d.systems.map((s) => s.path)).toContain('bf-verify-fdc/frontend');
    });

    it('a folder whose files differ is not a copy', async () => {
        const changed = files('bf-verify-fdc', 30).map(([p]): [string, string] => [p, 'other']);
        const l = listing(changed);
        const d = await detectSystems(l, reader(manifests));
        expect(d.systems.some((s) => s.copy)).toBe(false);
    });
});
