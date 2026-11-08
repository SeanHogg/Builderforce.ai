/** The status strip's readings: the chip's state and words, the tab it opens, the action button's label, the parity line, relative time. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import type { StoredReviewRun, SyncStatus } from '../types';
import type { ReviewState } from '../useReviewRun';
import { counted } from './plural';
import { liveRun, RUN_AT } from './run/runFixture';
import { parityText, relativeTime, stripAction, syncPill, type SyncPillInput } from './syncPill';

const h = L.surface.header;
const r = L.surface.run.review;
const idle: ReviewState = { status: 'idle' };
const sync = (over: Partial<SyncStatus> = {}): SyncStatus => ({ local: { files: 15994, docs: 0 }, server: { files: 15994, docs: 0 }, sources: [], ...over });
const pill = (over: Partial<SyncPillInput> = {}) => syncPill({ labels: L, review: idle, stale: false, refreshFailed: false, sync: null, ...over });
/** Six of ten files read 9.5 s in: 60%, 4 left. */
const run = (over: Partial<StoredReviewRun> = {}) => liveRun({ updatedAt: RUN_AT + 10_000, ...over });

describe('syncPill: the chip', () => {
    it('is "Not reviewed" with no sync report and no review time, and opens the Review tab', () => {
        expect(pill()).toMatchObject({ kind: 'never', state: 'idle', text: r.chipNotReviewedPlain, tab: 'review' });
    });

    it('counts the files of a folder that was never reviewed when the host reports them', () => {
        expect(pill({ sync: sync() }).text).toBe(fillTemplate(r.chipNotReviewed, { files: counted(L, 'file', 15994) }));
    });

    it('is "Reviewed … in sync", with the Runs tab, once the host reports a review time and both sides agree', () => {
        const now = Date.parse('2026-01-01T12:00:00Z');
        const p = pill({ lastReviewedAt: '2026-01-01T11:58:00Z', sync: sync(), now });
        expect(p).toMatchObject({ kind: 'upToDate', state: 'synced', tab: 'runs' });
        expect(p.text).toBe(fillTemplate(r.chipReviewedSynced, { age: relativeTime('2026-01-01T11:58:00Z', now) }));
    });

    it('says how many files were not stored, in the error colour, and opens the Server tab', () => {
        const p = pill({ lastReviewedAt: '2026-01-01T11:58:00Z', sync: sync({ skipped: [{ path: 'a.bin', reason: 'too-large' }, { path: 'b.bin', reason: 'unreadable' }] }) });
        expect(p).toMatchObject({ kind: 'notStored', state: 'error', tab: 'server' });
        expect(p.text).toContain(counted(L, 'fileNotStored', 2));
        expect(pill({ sync: sync({ skipped: [{ path: 'a.bin', reason: 'too-large' }] }) }).text).toBe('1 file not stored');
    });

    it('is out of date (partial) when both sides hold files and the counts differ', () => {
        expect(pill({ sync: sync({ server: { files: 15971, docs: 0 } }) })).toMatchObject({ kind: 'outOfDate', state: 'partial', tab: 'server' });
    });

    it('is the neutral server-only state when this machine has no snapshot, agreeing with the parity line', () => {
        const serverOnly = sync({ local: { files: 0, docs: 0 }, server: { files: 2945, docs: 0 } });
        expect(pill({ sync: serverOnly })).toMatchObject({ kind: 'serverOnly', state: 'serverOnly', tab: 'server' });
        expect(parityText(L, serverOnly)).toBe(counted(L, 'fileServerOnly', 2945, { server: (2945).toLocaleString() }));
    });

    it('is red with the Server tab when uploads failed, and syncing while changes wait', () => {
        const failed = sync({ replica: { dirty: 3, sending: false, failed: [{ reason: '500', status: 500 } as never] } });
        expect(pill({ sync: failed })).toMatchObject({ kind: 'uploadFailed', state: 'error', tab: 'server' });
        expect(pill({ sync: sync({ replica: { dirty: 3, sending: false, failed: [] } }) })).toMatchObject({ kind: 'uploading', state: 'syncing', tab: 'server' });
    });

    it('says Updating while a fresh read runs and "Couldn’t update" when it failed', () => {
        expect(pill({ stale: true })).toMatchObject({ state: 'syncing', text: L.refreshing });
        expect(pill({ refreshFailed: true, stale: true })).toMatchObject({ state: 'error', text: h.updateFailed });
    });

    it('counts while planning (with the walk\'s count when it has one), and is ready when the plan awaits an answer', () => {
        expect(pill({ review: { status: 'planning' } })).toMatchObject({ kind: 'counting', text: r.chipCountingPlain });
        expect(pill({ review: { status: 'planning', progress: { phase: 'plan', done: 12408, total: 0 } } }).text).toBe(fillTemplate(r.chipCounting, { files: counted(L, 'file', 12408) }));
        expect(pill({ review: { status: 'confirm', plan: {} as never } })).toMatchObject({ kind: 'ready', text: r.chipReady, tab: 'review' });
    });

    it('reviews with files read of files to read, the time left at the run\'s pace and the progress for the underline', () => {
        const p = pill({ review: { status: 'running' }, run: run() });
        expect(p).toMatchObject({ kind: 'running', state: 'syncing', tab: 'review' });
        expect(p.frac).toBeCloseTo(0.6);
        expect(p.text).toMatch(/^Reviewing · 6 of 10 · ~.+ left$/);
    });

    it('a run the host reports as still going is running too, though this view started no review (the record is the other source)', () => {
        const p = pill({ review: idle, run: run() });
        expect(p).toMatchObject({ kind: 'running', state: 'syncing', tab: 'review' });
        expect(p.text).toMatch(/^Reviewing · 6 of 10/);
        expect(pill({ review: idle, run: run({ endedAt: RUN_AT + 10_000, outcome: 'done' }) }).kind).not.toBe('running');
    });

    it('falls back to the review\'s own count before the first run record, and to plain "Reviewing…" with none', () => {
        expect(pill({ review: { status: 'running', progress: { phase: 'extract', done: 2, total: 8 } } }).text).toBe(fillTemplate(r.chipReviewingNoEta, { done: '2', total: '8' }));
        expect(pill({ review: { status: 'running' } }).text).toBe(r.chipReviewingPlain);
    });

    it('says it is stopping, and where it stopped with the files left (the Runs tab)', () => {
        expect(pill({ review: { status: 'stopping', stoppedAt: 0 } })).toMatchObject({ kind: 'stopping', text: r.chipStopping });
        const ended = run({ endedAt: RUN_AT + 10_000, outcome: 'stopped' });
        expect(pill({ review: { status: 'aborted' }, run: ended })).toMatchObject({ kind: 'stopped', state: 'partial', tab: 'runs', text: fillTemplate(r.chipStopped, { pct: 60, left: '4' }) });
        expect(pill({ review: { status: 'aborted' } }).text).toBe(r.chipStoppedPlain);
    });

    it('a review in flight outranks a stale refresh; a failed review is an error', () => {
        expect(pill({ review: { status: 'running' }, stale: true, refreshFailed: true }).state).toBe('syncing');
        expect(pill({ review: { status: 'error', message: 'x', at: '2026-01-01T00:00:00Z' } as ReviewState })).toMatchObject({ state: 'error', text: h.reviewFailed });
    });
});

describe('stripAction: the button is the next action', () => {
    const action = (over: Partial<SyncPillInput>, root: string | undefined = 'Docs') => stripAction(L, pill(over), root);

    it.each([
        ['never reviewed', {}, fillTemplate(r.actionReview, { root: 'Docs' }), false],
        ['out of date', { sync: sync({ server: { files: 1, docs: 0 } }) }, r.actionUpdate, false],
        ['files not stored', { sync: sync({ skipped: [{ path: 'a', reason: 'x' }] }) }, r.actionUpdate, false],
        ['counting', { review: { status: 'planning' } as ReviewState }, r.actionStart, true],
        ['plan ready', { review: { status: 'confirm', plan: {} as never } as ReviewState }, r.actionStart, false],
        ['running', { review: { status: 'running' } as ReviewState }, L.reviewStop, false],
        ['stopping', { review: { status: 'stopping', stoppedAt: 0 } as ReviewState }, r.stoppingTitle, true],
        ['stopped', { review: { status: 'aborted' } as ReviewState }, r.actionResume, false],
        ['up to date', { sync: sync(), lastReviewedAt: '2026-01-01T11:58:00Z' }, r.actionAgain, false],
    ])('%s', (_name, over, label, disabled) => {
        expect(action(over as Partial<SyncPillInput>)).toMatchObject({ label, disabled, tab: 'review' });
    });

    it('a failed upload opens the Server tab (the strip itself turns it into Retry upload when the source can retry)', () => {
        const failed = sync({ replica: { dirty: 1, sending: false, failed: [{ reason: 'x' } as never] } });
        expect(action({ sync: failed })).toMatchObject({ label: r.actionSeeUpload, tab: 'server' });
    });
});

describe('parityText', () => {
    it('is null without a report', () => {
        expect(parityText(L, null)).toBeNull();
    });

    it('says "here and on the server" when the counts agree, both counts when they differ, and local-only without a server', () => {
        expect(parityText(L, sync())).toBe(counted(L, 'fileBoth', 15994, { count: (15994).toLocaleString() }));
        expect(parityText(L, sync({ server: { files: 15971, docs: 0 } })))
            .toBe(fillTemplate(h.parityDiffers, { local: (15994).toLocaleString(), server: (15971).toLocaleString() }));
        const { server: _server, ...local } = sync();
        expect(parityText(L, local)).toBe(counted(L, 'fileLocalOnly', 15994, { local: (15994).toLocaleString() }));
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
