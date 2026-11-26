import { describe, expect, it } from 'vitest';
import type { Commit } from '../types';
import { codeCompareOf, compareRevs, compareView, type CompareRevs, type CompareState } from './compareModel';

const NO_REVS: CompareRevs = { before: null, after: null };
const restructureView = (moved: ReadonlyMap<string, string>, spans = [{ path: 'a.ts', from: 1, to: 3, module: 'src:r::a.f.ts' }]) =>
    ({ ...compareView({ source: 'restructure', side: 'before', findingId: 'f' }, null, NO_REVS), moved, spans });

describe('codeCompareOf', () => {
    it('is nothing without a comparison', () => {
        expect(codeCompareOf(null)).toBeUndefined();
        expect(codeCompareOf(undefined)).toBeUndefined();
    });

    it('a restructure with moved definitions carries them and their lines', () => {
        const moved = new Map([['src:r::a.ts#f', 'src:r::a.f.ts']]);
        expect(codeCompareOf(restructureView(moved))).toEqual({ side: 'before', revs: NO_REVS, moved, spans: [{ path: 'a.ts', from: 1, to: 3, module: 'src:r::a.f.ts' }] });
    });

    it('a restructure that moves no definitions leaves the pane as it was', () => {
        expect(codeCompareOf(restructureView(new Map()))).toBeUndefined();
    });

    it('a revision comparison carries the side and the revisions', () => {
        const view = compareView({ source: 'baseline', side: 'before' }, null, { before: 'c'.repeat(40), after: null });
        expect(codeCompareOf(view)).toEqual({ side: 'before', revs: { before: 'c'.repeat(40), after: null } });
    });
});

describe('a commit comparison reads Before at the parent and After at the commit', () => {
    const commit: Commit = { sha: 'b'.repeat(40), title: 't', at: '2026-01-01T00:00:00Z', refs: [] };
    const state = (c: Commit): CompareState => ({ source: 'commit', side: 'after', commit: c });

    it('with a parent', () => {
        const parent = 'a'.repeat(40);
        const revs = compareRevs(state({ ...commit, parent }), null, null);
        expect(revs).toEqual({ before: parent, after: commit.sha });
        expect(codeCompareOf(compareView(state({ ...commit, parent }), null, revs))).toEqual({ side: 'after', revs });
    });

    it('without one, Before has no revision (the pane says the earlier version is not available)', () => {
        expect(compareRevs(state(commit), null, null)).toEqual({ before: null, after: commit.sha });
    });
});
