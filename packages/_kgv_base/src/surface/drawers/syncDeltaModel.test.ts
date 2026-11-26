import { describe, expect, it } from 'vitest';
import { deltaFeed, pendingCount, sourceAction, splitSkipped } from './syncDeltaModel';

const commit = (sha: string, at: string, refs: string[] = ['a']) => ({ sha, title: `t ${sha}`, at, refs });

describe('deltaFeed', () => {
    it('lists newest first and marks commits after the last review as pending', () => {
        const rows = deltaFeed([commit('a', '2026-01-01T00:00:00Z'), commit('c', '2026-01-03T00:00:00Z', ['x', 'y']), commit('b', '2026-01-02T00:00:00Z')], '2026-01-02T00:00:00Z');
        expect(rows.map((r) => [r.sha, r.state])).toEqual([['c', 'pending'], ['b', 'applied'], ['a', 'applied']]);
        expect(rows[0]!.files).toBe(2);
        expect(pendingCount(rows)).toBe(1);
    });
    it('calls nothing applied when no review time is known, and caps the list', () => {
        const many = Array.from({ length: 20 }, (_, i) => commit(String(i), `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`));
        const rows = deltaFeed(many, undefined);
        expect(rows).toHaveLength(8);
        expect(rows.every((r) => r.state === 'pending')).toBe(true);
    });
    it('carries the author only when the host gave one', () => {
        const rows = deltaFeed([{ ...commit('a', '2026-01-01T00:00:00Z'), author: 'Sean' }, commit('b', '2026-01-02T00:00:00Z')], undefined);
        expect(rows.find((r) => r.sha === 'a')!.author).toBe('Sean');
        expect(rows.find((r) => r.sha === 'b')).not.toHaveProperty('author');
    });
});

describe('deltaFeed across timezones', () => {
    it('orders and splits by instant, not by the text of the timestamp', () => {
        // 10:00+05:00 is 05:00Z, EARLIER than 08:00Z although its text sorts later.
        const rows = deltaFeed([commit('early', '2026-01-02T10:00:00+05:00'), commit('late', '2026-01-02T08:00:00Z')], '2026-01-02T06:00:00Z');
        expect(rows.map((r) => r.sha)).toEqual(['late', 'early']);
        expect(rows.map((r) => r.state)).toEqual(['pending', 'applied']);
    });
});

describe('splitSkipped', () => {
    it('separates the folders the walk never read from the skipped files', () => {
        const out = splitSkipped([
            { path: 'big.json', bytes: 9, reason: 'too-large' },
            { path: 'vendored', reason: 'nested-checkout' },
            { path: 'x.local', reason: 'local-state' },
            { path: '_a_src', reason: 'vendored-src' },
            { path: '.worktrees', reason: 'worktrees' },
        ]);
        expect(out.files.map((f) => f.path)).toEqual(['big.json']);
        expect(out.folders.map((f) => f.kind)).toEqual(['nested', 'local', 'vendored', 'worktrees']);
    });
});

describe('sourceAction', () => {
    it('offers set-up only where a source is not collected', () => {
        expect(sourceAction({ id: 'coverage', state: 'absent' })).toMatchObject({ kind: 'compose', label: 'actionSetUpV8' });
        expect(sourceAction({ id: 'coverage', state: 'collected' })).toEqual({ kind: 'none' });
        expect(sourceAction({ id: 'traces', state: 'absent' })).toMatchObject({ label: 'actionTurnOn' });
        expect(sourceAction({ id: 'openapi', state: 'estimated' })).toMatchObject({ kind: 'panel', panel: 'api' });
        expect(sourceAction({ id: 'code', state: 'absent' })).toEqual({ kind: 'none' });
    });
});
