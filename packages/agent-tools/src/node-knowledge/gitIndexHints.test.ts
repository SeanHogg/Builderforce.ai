import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GIT_STATUS_ARGS, gitBlobId, gitIndexHints, parseDirtyAgainstIndex, parseLsFilesStaged } from './gitIndexHints.js';

const folders: string[] = [];
afterEach(() => { for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true }); });

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe('git index hints: parsing', () => {
    it('keeps stage-0 regular files git really checks (tag H); leaves assume-unchanged, skip-worktree, symlinks, gitlinks and conflicts out', () => {
        const out = [
            'H 100644 aaa 0\tsrc/a b.ts',
            'H 100755 bbb 0\tbin/run',
            'h 100644 ccc 0\tassumed.ts',
            'S 100644 ddd 0\tsparse.ts',
            'H 120000 eee 0\tlink',
            'H 160000 fff 0\tvendor/sub',
            'M 100644 ggg 1\tconflict.ts',
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

    it('the background status never takes the index lock', () => {
        expect(GIT_STATUS_ARGS[0]).toBe('--no-optional-locks');
        expect(GIT_STATUS_ARGS).toContain('status');
    });

    it("gitBlobId is git's blob id of the bytes", () => {
        // `printf 'hello\n' | git hash-object --stdin`
        expect(gitBlobId(new TextEncoder().encode('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    });
});

describe.runIf(hasGit)('git index hints: a real work tree', () => {
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe' });

    function repo(): string {
        const dir = mkdtempSync(join(tmpdir(), 'git-hints-'));
        folders.push(dir);
        git(dir, 'init', '-q');
        git(dir, 'config', 'core.autocrlf', 'false');
        return dir;
    }

    it('gives the blob of each clean tracked file under the root (root-relative), and none for an edited one', async () => {
        const root = repo();
        mkdirSync(join(root, 'pkg', 'src'), { recursive: true });
        writeFileSync(join(root, 'top.ts'), 'top');
        writeFileSync(join(root, 'pkg', 'src', 'clean.ts'), 'clean');
        writeFileSync(join(root, 'pkg', 'src', 'edited.ts'), 'before');
        git(root, 'add', '.');
        git(root, 'commit', '-q', '-m', 'init');
        writeFileSync(join(root, 'pkg', 'src', 'edited.ts'), 'after');
        writeFileSync(join(root, 'pkg', 'untracked.ts'), 'new');
        const hints = await gitIndexHints(join(root, 'pkg'));
        expect(hints).toBeDefined();
        expect([...hints!.blobs.keys()]).toEqual(['src/clean.ts']);
        const blob = git(root, 'rev-parse', 'HEAD:pkg/src/clean.ts').toString().trim();
        expect(hints!.blobs.get('src/clean.ts')).toBe(blob);
        expect(gitBlobId(readFileSync(join(root, 'pkg', 'src', 'clean.ts')))).toBe(blob);
    });

    it('gives no hint for an assume-unchanged file edited at the same size (status would call it clean)', async () => {
        const root = repo();
        writeFileSync(join(root, 'a.ts'), 'aaaa');
        writeFileSync(join(root, 'b.ts'), 'bbbb');
        git(root, 'add', '.');
        git(root, 'commit', '-q', '-m', 'init');
        git(root, 'update-index', '--assume-unchanged', 'a.ts');
        writeFileSync(join(root, 'a.ts'), 'AAAA');
        const hints = await gitIndexHints(root);
        expect([...hints!.blobs.keys()]).toEqual(['b.ts']);
    });

    it('is undefined outside a work tree', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'git-hints-none-'));
        folders.push(dir);
        expect(await gitIndexHints(dir)).toBeUndefined();
    });
});
