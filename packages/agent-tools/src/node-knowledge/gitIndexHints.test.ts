import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitIndexHints, parseDirtyAgainstIndex, parseLsFilesStaged } from './gitIndexHints.js';

const folders: string[] = [];
afterEach(() => { for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true }); });

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe('git index hints: parsing', () => {
    it('keeps stage-0 regular files and leaves symlinks, gitlinks and conflict stages out', () => {
        const out = [
            '100644 aaa 0\tsrc/a b.ts',
            '100755 bbb 0\tbin/run',
            '120000 ccc 0\tlink',
            '160000 ddd 0\tvendor/sub',
            '100644 eee 1\tconflict.ts',
        ].join('\0') + '\0';
        expect([...parseLsFilesStaged(out)]).toEqual([['src/a b.ts', 'aaa'], ['bin/run', 'bbb']]);
    });

    it('names a path dirty only when its work tree differs from the index (or it is unmerged)', () => {
        const h = '0'.repeat(40);
        const out = [
            `1 .M N... 100644 100644 100644 ${h} ${h} dir/edited file.ts`,
            `1 M. N... 100644 100644 100644 ${h} ${h} staged-only.ts`,
            `2 R. N... 100644 100644 100644 ${h} ${h} R100 renamed.ts`, 'old-name.ts',
            `2 RM N... 100644 100644 100644 ${h} ${h} R100 renamed-edited.ts`, 'old2.ts',
            `u UU N... 100644 100644 100644 100644 ${h} ${h} ${h} both.ts`,
        ].join('\0') + '\0';
        expect([...parseDirtyAgainstIndex(out)].sort()).toEqual(['both.ts', 'dir/edited file.ts', 'renamed-edited.ts']);
    });
});

describe.runIf(hasGit)('git index hints: a real work tree', () => {
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe' });

    it('gives the blob of each clean tracked file under the root (root-relative), and none for an edited one', async () => {
        const repo = mkdtempSync(join(tmpdir(), 'git-hints-'));
        folders.push(repo);
        mkdirSync(join(repo, 'pkg', 'src'), { recursive: true });
        writeFileSync(join(repo, 'top.ts'), 'top');
        writeFileSync(join(repo, 'pkg', 'src', 'clean.ts'), 'clean');
        writeFileSync(join(repo, 'pkg', 'src', 'edited.ts'), 'before');
        git(repo, 'init', '-q');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'init');
        writeFileSync(join(repo, 'pkg', 'src', 'edited.ts'), 'after');
        writeFileSync(join(repo, 'pkg', 'untracked.ts'), 'new');
        const hints = await gitIndexHints(join(repo, 'pkg'));
        expect(hints).toBeDefined();
        expect([...hints!.blobs.keys()]).toEqual(['src/clean.ts']);
        expect(hints!.blobs.get('src/clean.ts')).toBe(git(repo, 'rev-parse', 'HEAD:pkg/src/clean.ts').toString().trim());
    });

    it('is undefined outside a work tree', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'git-hints-none-'));
        folders.push(dir);
        expect(await gitIndexHints(dir)).toBeUndefined();
    });
});
