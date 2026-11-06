/** The status strip's readings: the sync pill's state and words, the parity line, relative time. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import type { SyncStatus } from '../types';
import type { ReviewState } from '../useReviewRun';
import { parityText, relativeTime, syncPill, type SyncPillInput } from './syncPill';

const h = L.surface.header;
const idle: ReviewState = { status: 'idle' };
const sync = (over: Partial<SyncStatus> = {}): SyncStatus => ({ local: { files: 15994, docs: 0 }, server: { files: 15994, docs: 0 }, sources: [], ...over });
const pill = (over: Partial<SyncPillInput> = {}) => syncPill({ labels: L, review: idle, stale: false, refreshFailed: false, sync: null, ...over });

describe('syncPill', () => {
    it('is idle "Not synced" with no sync report and no review time', () => {
        expect(pill()).toEqual({ state: 'idle', text: h.notSynced });
    });

    it('is synced, with how long ago, once the host reports a review time or a status', () => {
        const now = Date.parse('2026-01-01T12:00:00Z');
        const p = pill({ lastReviewedAt: '2026-01-01T11:58:00Z', now });
        expect(p.state).toBe('synced');
        expect(p.text).toBe(fillTemplate(h.syncedAt, { time: relativeTime('2026-01-01T11:58:00Z', now) }));
        expect(pill({ sync: sync() })).toEqual({ state: 'synced', text: h.synced });
    });

    it('is an error when the host reports skipped files', () => {
        expect(pill({ sync: sync({ skipped: [{ path: 'a.bin', reason: 'too-large' }, { path: 'b.bin', reason: 'unreadable' }] }) }))
            .toEqual({ state: 'error', text: fillTemplate(h.skippedPill, { count: 2 }) });
    });

    it('says Updating while a fresh read runs and "Couldn’t update" when it failed', () => {
        expect(pill({ stale: true })).toEqual({ state: 'syncing', text: L.refreshing });
        expect(pill({ refreshFailed: true, stale: true })).toEqual({ state: 'error', text: h.updateFailed });
    });

    it('is syncing with the phase, n of m while a review runs, and the plan awaits confirmation', () => {
        const running: ReviewState = { status: 'running', progress: { phase: 'judge', done: 2, total: 5 } };
        expect(pill({ review: running })).toEqual({ state: 'syncing', text: fillTemplate(h.reviewing, { progress: 'Judging · 2 of 5' }) });
        expect(pill({ review: { status: 'planning' } })).toEqual({ state: 'syncing', text: fillTemplate(h.reviewing, { progress: L.reviewPlanning }) });
        expect(pill({ review: { status: 'running' } }).text).toBe(fillTemplate(h.reviewing, { progress: L.reviewPlanning }));
        expect(pill({ review: { status: 'confirm', plan: {} as never } })).toEqual({ state: 'syncing', text: h.reviewPlan });
    });

    it('a review in flight outranks a stale refresh; a failed review is an error', () => {
        expect(pill({ review: { status: 'running' }, stale: true, refreshFailed: true }).state).toBe('syncing');
        expect(pill({ review: { status: 'error', message: 'x', at: '2026-01-01T00:00:00Z' } as ReviewState })).toEqual({ state: 'error', text: h.reviewFailed });
    });
});

describe('parityText', () => {
    it('is null without a report', () => {
        expect(parityText(L, null)).toBeNull();
    });

    it('says "here and on the server" when the counts agree, both counts when they differ, and local-only without a server', () => {
        expect(parityText(L, sync())).toBe(fillTemplate(h.parityBoth, { count: (15994).toLocaleString() }));
        expect(parityText(L, sync({ server: { files: 15971, docs: 0 } })))
            .toBe(fillTemplate(h.parityDiffers, { local: (15994).toLocaleString(), server: (15971).toLocaleString() }));
        const { server: _server, ...local } = sync();
        expect(parityText(L, local)).toBe(fillTemplate(h.parityLocal, { local: (15994).toLocaleString() }));
    });
});

describe('relativeTime', () => {
    it('reads minutes, hours and days, and nothing for an unreadable time', () => {
        const now = Date.parse('2026-01-10T12:00:00Z');
        expect(relativeTime('2026-01-10T11:55:00Z', now)).toMatch(/5/);
        expect(relativeTime('2026-01-10T09:00:00Z', now)).toMatch(/3/);
        expect(relativeTime('2026-01-08T12:00:00Z', now)).toMatch(/2/);
        expect(relativeTime('not a time', now)).toBe('');
    });
});
