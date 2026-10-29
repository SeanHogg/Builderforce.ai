import { describe, expect, it } from 'vitest';
import type { CapabilityProvider } from '../capabilities.js';
import { fingerprintSha, workspaceFingerprint } from './workspaceFingerprint.js';

function caps(answers: Record<string, string | null>): CapabilityProvider {
    return {
        capabilities: new Set(),
        shell: {
            run: async (command: string) => {
                const hit = Object.entries(answers).find(([prefix]) => command.startsWith(prefix));
                if (!hit || hit[1] === null) return { ok: false, exitCode: 128, stdout: '' };
                return { ok: true, exitCode: 0, stdout: hit[1] };
            },
        },
    } as unknown as CapabilityProvider;
}

describe('the workspace fingerprint', () => {
    it('is the commit alone for a clean tree', async () => {
        const fp = await workspaceFingerprint({ caps: caps({ 'git rev-parse': 'abc\n', 'git branch': 'main', 'git status': '' }) });
        expect(fp).toEqual({ commit: 'abc', branch: 'main', dirty: false });
        expect(fingerprintSha(fp)).toBe('abc');
    });

    it('adds a digest of the uncommitted state, distinct per state', async () => {
        const at = (status: string, diff = '') => workspaceFingerprint({ caps: caps({ 'git rev-parse': 'abc', 'git branch': 'main', 'git status': status, 'git diff': diff }) });
        const a = await at(' M src/a.ts', 'diff A');
        const b = await at(' M src/a.ts', 'diff B');
        const c = await at(' M src/b.ts', 'diff A');
        expect(a.dirty).toBe(true);
        expect(fingerprintSha(a)).toMatch(/^abc\+[0-9a-f]{1,16}$/);
        expect(new Set([fingerprintSha(a), fingerprintSha(b), fingerprintSha(c)]).size).toBe(3);
        expect(fingerprintSha(await at(' M src/a.ts', 'diff A'))).toBe(fingerprintSha(a));
    });

    it('does not count the analyzers\' own scratch output as a change', async () => {
        const fp = await workspaceFingerprint({ caps: caps({ 'git rev-parse': 'abc', 'git branch': 'main', 'git status': '?? .builderforce/code-analysis/x/report.json' }) });
        expect(fp.dirty).toBe(false);
    });

    it('cannot identify a tree git cannot describe', async () => {
        const none = await workspaceFingerprint({ caps: caps({ 'git rev-parse': null, 'git branch': null, 'git status': null }) });
        expect(none).toMatchObject({ commit: null, dirty: null });
        expect(fingerprintSha(none)).toBeNull();
        expect(await workspaceFingerprint({ caps: { capabilities: new Set() } as unknown as CapabilityProvider })).toEqual({ commit: null, branch: null, dirty: null });
    });
});
