import { describe, expect, it } from 'vitest';
import type { CapabilityProvider } from '../capabilities.js';
import { fingerprintSha, forgetWorkspaceFingerprints, workspaceFingerprint } from './workspaceFingerprint.js';

const SHA = 'a'.repeat(40);
const treeOf = (n: string): string => n.repeat(40).slice(0, 40);

interface Repo { head?: string | null; prefix?: string; branch?: string; status?: string | null; tree?: string | null }

/** A shell that answers like git does for `repo`, recording every command. */
function caps(repo: Repo): { caps: CapabilityProvider; commands: string[] } {
    const commands: string[] = [];
    const ok = (stdout: string) => ({ ok: true, exitCode: 0, stdout });
    const fail = { ok: false, exitCode: 128, stdout: '' };
    return {
        commands,
        caps: {
            capabilities: new Set(),
            shell: {
                run: async (command: string) => {
                    commands.push(command);
                    if (command.includes('rev-parse --show-toplevel --show-prefix HEAD')) {
                        return repo.head === null ? fail : ok(`/work/repo\n${repo.prefix ?? ''}\n${repo.head ?? SHA}\n`);
                    }
                    if (command.includes('branch --show-current')) return ok(`${repo.branch ?? 'main'}\n`);
                    if (command.includes('status --porcelain')) return repo.status === null ? fail : ok(repo.status ?? '');
                    if (command.includes('write-tree')) return repo.tree === null ? fail : ok(`${repo.tree ?? treeOf('1')}\n`);
                    return fail;
                },
            },
        } as unknown as CapabilityProvider,
    };
}

describe('the workspace fingerprint', () => {
    it('is the commit alone for a clean tree', async () => {
        const fp = await workspaceFingerprint({ caps: caps({ status: '' }).caps });
        expect(fp).toEqual({ commit: SHA, branch: 'main', dirty: false, prefix: '' });
        expect(fingerprintSha(fp)).toBe(SHA);
    });

    it('adds the id of the working tree when dirty, distinct per state, with a separator the API accepts', async () => {
        const at = (status: string, tree: string) => workspaceFingerprint({ caps: caps({ status, tree }).caps });
        const a = await at(' M src/a.ts', treeOf('1'));
        const b = await at(' M src/a.ts', treeOf('2'));
        const c = await at(' M src/b.ts', treeOf('1'));
        expect(a.dirty).toBe(true);
        // The API's KNOWLEDGE_HASH_PATTERN: /^~?[A-Za-z0-9._:-]{1,160}$/ — no `+`.
        expect(fingerprintSha(a)).toMatch(/^[0-9a-f]{40}\.[0-9a-f]{1,16}$/);
        expect(fingerprintSha(a)).toMatch(/^~?[A-Za-z0-9._:-]{1,160}$/);
        expect(fingerprintSha(a)).not.toBe(fingerprintSha(b));
        // The tree id IS the content, whichever files git calls changed.
        expect(fingerprintSha(a)).toBe(fingerprintSha(c));
        expect(fingerprintSha(await at(' M src/a.ts', treeOf('1')))).toBe(fingerprintSha(a));
    });

    it('does not count the host\'s own .builderforce state as a change, at any depth, but does count the review inputs', async () => {
        const state = await workspaceFingerprint({ caps: caps({ status: '?? .builderforce/code-analysis/x/report.json\n?? pkg/.builderforce/knowledge/a.json' }).caps });
        expect(state.dirty).toBe(false);
        const input = await workspaceFingerprint({ caps: caps({ status: ' M .builderforce/partitions.json' }).caps });
        expect(input.dirty).toBe(true);
    });

    it('records where the folder sits in the repository', async () => {
        const fp = await workspaceFingerprint({ caps: caps({ prefix: 'packages/x/', status: '' }).caps });
        expect(fp.prefix).toBe('packages/x');
    });

    it('cannot identify a tree git cannot describe, or a dirty one it cannot write', async () => {
        const none = await workspaceFingerprint({ caps: caps({ head: null }).caps });
        expect(none).toMatchObject({ commit: null, dirty: null });
        expect(fingerprintSha(none)).toBeNull();
        const unwritable = await workspaceFingerprint({ caps: caps({ status: ' M a.ts', tree: null }).caps });
        expect(unwritable.dirty).toBe(true);
        expect(fingerprintSha(unwritable)).toBeNull();
        expect(await workspaceFingerprint({ caps: { capabilities: new Set() } as unknown as CapabilityProvider })).toEqual({ commit: null, branch: null, dirty: null });
    });

    it('never puts a file name on a command line, whatever the files are called', async () => {
        const nasty = '$(touch x).ts';
        const ticks = '`touch y`.ts';
        const { caps: c, commands } = caps({ status: `?? "${nasty}"\n?? "${ticks}"\n M "a b.ts"` });
        const fp = await workspaceFingerprint({ caps: c });
        expect(fp.dirty).toBe(true);
        expect(fingerprintSha(fp)).not.toBeNull();
        for (const command of commands) {
            expect(command).not.toContain('touch');
            expect(command).not.toContain('a b.ts');
            expect(command).not.toContain('hash-object');
        }
    });

    it('reads git without taking locks, from the top level, and answers repeat askers from one read', async () => {
        const { caps: c, commands } = caps({ status: ' M a.ts' });
        const first = await workspaceFingerprint({ caps: c });
        const again = await workspaceFingerprint({ caps: c });
        expect(again).toEqual(first);
        const gitCommands = commands.filter((cmd) => cmd.includes('git '));
        // rev-parse, branch, status and the working-tree script — once.
        expect(gitCommands).toHaveLength(4);
        for (const cmd of commands.filter((x) => !x.startsWith('set -e'))) expect(cmd.startsWith('git --no-optional-locks ')).toBe(true);
        const script = commands.find((cmd) => cmd.startsWith('set -e'))!;
        expect(script).toContain('cd "$(git --no-optional-locks rev-parse --show-toplevel)"');
        expect(script).toContain('GIT_INDEX_FILE');
        // Every git in the script takes no locks.
        expect(script.match(/\bgit (?!--no-optional-locks)/g) ?? []).toEqual([]);
        // A fresh memo (another process turn) reads again.
        forgetWorkspaceFingerprints();
        await workspaceFingerprint({ caps: c });
        expect(commands.filter((cmd) => cmd.includes('rev-parse --show-toplevel --show-prefix')).length).toBe(2);
    });

    it('one asker stopping does not take the fingerprint from another who is still waiting', async () => {
        // A shell that honours the signal it is given, as the real ones do (a killed git answers nothing).
        const base = caps({ status: '' }).caps;
        const run = base.shell!.run.bind(base.shell);
        (base.shell as { run: unknown }).run = async (command: string, opts?: { signal?: AbortSignal }) => {
            await new Promise((r) => setTimeout(r, 5));
            if (opts?.signal?.aborted) return { ok: false, aborted: true, exitCode: 1, stdout: '' };
            return run(command);
        };
        const first = new AbortController();
        const second = new AbortController();
        const a = workspaceFingerprint({ caps: base, signal: first.signal });
        const b = workspaceFingerprint({ caps: base, signal: second.signal });
        first.abort();
        expect(await b).toEqual({ commit: SHA, branch: 'main', dirty: false, prefix: '' });
        await a;

        // Every asker stopped: nothing is remembered, the next asker reads for itself.
        forgetWorkspaceFingerprints();
        const gone = new AbortController();
        const stopped = workspaceFingerprint({ caps: base, signal: gone.signal });
        gone.abort();
        await stopped;
        expect(await workspaceFingerprint({ caps: base })).toEqual({ commit: SHA, branch: 'main', dirty: false, prefix: '' });
    });
});

