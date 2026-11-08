/**
 * The status strip's readings, as pure functions. The STATUS CHIP: what is true now ("Reviewed Nov 2 · 397 files not stored", "Reviewing · 5,205 of 18,845 · ~45 min left",
 * "Stopped at 27% · 13,640 left"), its dot's state and the Reviews tab that explains it. The ACTION BUTTON: the next action for that situation. Both open the Reviews panel.
 * Also the server-parity line (the Server tab shows it). React-free.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import type { StoredReviewRun, SyncStatus } from '../types';
import type { ReviewState } from '../useReviewRun';
import { notStored } from './drawers/syncDeltaModel';
import { replicaPartsText } from './drawers/replicaPack';
import { counted } from './plural';
import { spanText } from './run/runModel';
import { extractProgress } from './run/runPace';
import type { ReviewsTab } from './run/useReviewsTab';
import type { StatusState } from './ui';

/** The situation the strip describes: the chip's words and the button's action both follow it. */
export type PillKind =
    | 'counting' | 'ready' | 'running' | 'stopping' | 'stopped' | 'failed' | 'refresh'
    | 'notStored' | 'serverOnly' | 'uploadFailed' | 'uploading' | 'outOfDate' | 'never' | 'upToDate';

export interface SyncPill {
    state: StatusState;
    text: string;
    kind: PillKind;
    /** The Reviews tab the chip opens: the one that explains the message. */
    tab: ReviewsTab;
    /** While reviewing: files read over files to read (0 to 1), for the chip's underline. */
    frac?: number;
}

export interface SyncPillInput {
    labels: KnowledgeGraphLabels;
    review: ReviewState;
    /** A fresh read is running behind the graph on screen. */
    stale: boolean;
    /** The fresh read failed; the last graph is still shown. */
    refreshFailed: boolean;
    /** The source's report about the server; null = the host reports none (or it has not arrived). */
    sync: SyncStatus | null;
    /** When the folder was last reviewed (ISO), if the host knows. */
    lastReviewedAt?: string | undefined;
    /** The live run record of the open folder: the pace behind "~45 min left" and the files left after a stop. */
    run?: StoredReviewRun | null | undefined;
    now?: number;
}

/** "2 minutes ago", in the reader's locale; an unreadable time is "". */
export function relativeTime(iso: string, now: number = Date.now()): string {
    const at = Date.parse(iso);
    if (Number.isNaN(at)) return '';
    const seconds = Math.round((at - now) / 1000);
    const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const abs = Math.abs(seconds);
    if (abs < 3600) return fmt.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return fmt.format(Math.round(seconds / 3600), 'hour');
    return fmt.format(Math.round(seconds / 86400), 'day');
}

/** A review date in the reader's locale ("Nov 7, 2026"); an unreadable one is "". */
export function reviewDate(iso: string): string {
    const at = Date.parse(iso);
    return Number.isNaN(at) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(at));
}

export function syncPill({ labels, review, stale, refreshFailed, sync, lastReviewedAt, run, now }: SyncPillInput): SyncPill {
    const h = labels.surface.header;
    const r = labels.surface.run.review;
    const date = lastReviewedAt ? reviewDate(lastReviewedAt) : '';
    const read = run ? extractProgress(run) : undefined;
    const make = (kind: PillKind, state: StatusState, text: string, tab: ReviewsTab = 'review', frac?: number): SyncPill => ({ kind, state, text, tab, ...(frac !== undefined ? { frac } : {}) });

    if (review.status === 'planning') {
        const so_far = review.progress?.done ?? 0;
        return make('counting', 'syncing', so_far > 0 ? fillTemplate(r.chipCounting, { files: counted(labels, 'file', so_far) }) : r.chipCountingPlain);
    }
    if (review.status === 'confirm') return make('ready', 'syncing', r.chipReady);
    if (review.status === 'stopping') return make('stopping', 'syncing', r.chipStopping);
    // A run the host reports as still going is running too (a review this view did not start, or one started in another window): the record is the other source of "running".
    const hostRunning = !!run && run.endedAt === undefined && (review.status === 'idle' || review.status === 'cancelled');
    if (review.status === 'running' || hostRunning) {
        // The run record leads; before its first post, the review's own progress stands in while it is reading files.
        const progress = review.status === 'running' ? review.progress : undefined;
        const own = progress && progress.phase === 'extract' && progress.total > 0 ? progress : undefined;
        const done = read?.done ?? own?.done, total = read?.total ?? own?.total;
        if (done === undefined || total === undefined || total <= 0) return make('running', 'syncing', r.chipReviewingPlain);
        const eta = read?.etaMs;
        const args = { done: done.toLocaleString(), total: total.toLocaleString() };
        return make('running', 'syncing', eta !== undefined && eta > 0 ? fillTemplate(r.chipReviewing, { ...args, eta: spanText(labels, eta) }) : fillTemplate(r.chipReviewingNoEta, args), 'review', done / total);
    }
    if (review.status === 'aborted') {
        return read
            ? make('stopped', 'partial', fillTemplate(r.chipStopped, { pct: read.pct, left: Math.max(0, read.total - read.done).toLocaleString() }), 'runs')
            : make('stopped', 'partial', r.chipStoppedPlain, 'runs');
    }
    if (review.status === 'error') return make('failed', 'error', h.reviewFailed);
    if (refreshFailed) return make('refresh', 'error', h.updateFailed);
    if (stale) return make('refresh', 'syncing', labels.refreshing);
    // Files the review did not store: the Server tab says which.
    const leftOut = sync?.skipped ? notStored(sync.skipped) : [];
    if (leftOut.length > 0) {
        const stored = counted(labels, 'fileNotStored', leftOut.length);
        return make('notStored', 'error', date ? fillTemplate(r.chipReviewedStored, { date, stored }) : stored, 'server');
    }
    // No snapshot on this machine is not a fault: the folder was reviewed on the server only.
    if (sync && hasNoLocalSnapshot(sync)) return make('serverOnly', 'serverOnly', fillTemplate(r.chipNotReviewed, { files: counted(labels, 'file', sync.server?.files ?? 0) }), 'server');
    // The map is local; the replica is what the project has not received yet (PRD 41 A7).
    if (sync?.replica && sync.replica.failed.length > 0) return make('uploadFailed', 'error', counted(labels, 'replicaFailed', sync.replica.failed.length), 'server');
    if (sync?.replica && sync.replica.dirty > 0) return make('uploading', 'syncing', replicaPartsText(labels, sync.replica) ?? counted(labels, 'replicaQueued', sync.replica.dirty), 'server');
    if (sync?.server && sync.server.files !== sync.local.files) return make('outOfDate', 'partial', date ? fillTemplate(r.chipOutOfDate, { date }) : r.chipNotReviewedPlain, 'server');
    // Never "up to date" while the local side holds no files: nothing here is in step with anything.
    if (sync && sync.local.files === 0) return make('never', 'idle', r.chipNotReviewedPlain);
    if (lastReviewedAt) {
        const age = relativeTime(lastReviewedAt, now);
        return make('upToDate', 'synced', age ? fillTemplate(r.chipReviewedSynced, { age }) : fillTemplate(r.chipReviewed, { date }), 'runs');
    }
    if (sync) return make('never', 'idle', fillTemplate(r.chipNotReviewed, { files: counted(labels, 'file', sync.local.files) }));
    return make('never', 'idle', r.chipNotReviewedPlain);
}

export interface StripAction {
    label: string;
    /** Counting cannot be started or stopped: the button waits. */
    disabled: boolean;
    tab: ReviewsTab;
}

/** The button for the situation: it opens the panel on Review, where the action itself is; a failed upload opens the Server tab (the strip makes it Retry upload when the source can retry). */
export function stripAction(labels: KnowledgeGraphLabels, pill: Pick<SyncPill, 'kind'>, rootTitle: string | undefined): StripAction {
    const r = labels.surface.run.review;
    const go = (label: string, disabled = false, tab: ReviewsTab = 'review'): StripAction => ({ label, disabled, tab });
    switch (pill.kind) {
        case 'counting': return go(r.actionStart, true);
        case 'ready': return go(r.actionStart);
        case 'running': return go(labels.reviewStop);
        case 'stopping': return go(r.stoppingTitle, true);
        case 'stopped': return go(r.actionResume);
        case 'uploadFailed': return go(r.actionSeeUpload, false, 'server'); // the strip turns this into Retry upload when the source has the port
        case 'never': return go(fillTemplate(r.actionReview, { root: rootTitle ?? labels.reviewFolder }));
        case 'serverOnly': return go(fillTemplate(r.actionReview, { root: rootTitle ?? labels.reviewFolder }));
        case 'notStored': case 'outOfDate': case 'refresh': return go(r.actionUpdate);
        case 'failed': case 'uploading': case 'upToDate': return go(r.actionAgain);
    }
}

/** This machine holds no snapshot of the folder (a linked project is reviewed on the server only): "0 here" means that. */
export const hasNoLocalSnapshot = (sync: Pick<SyncStatus, 'local' | 'server'>): boolean => sync.local.files === 0 && (sync.server?.files ?? 0) > 0;

/** The server-parity line; null when the host reports no status. */
export function parityText(labels: KnowledgeGraphLabels, sync: SyncStatus | null): string | null {
    if (!sync) return null;
    const h = labels.surface.header;
    const fmt = (n: number) => n.toLocaleString();
    const local = sync.local.files;
    if (hasNoLocalSnapshot(sync) && sync.server) return counted(labels, 'fileServerOnly', sync.server.files, { server: fmt(sync.server.files) });
    if (!sync.server) return counted(labels, 'fileLocalOnly', local, { local: fmt(local) });
    if (sync.server.files === local) return counted(labels, 'fileBoth', local, { count: fmt(local) });
    return fillTemplate(h.parityDiffers, { local: fmt(local), server: fmt(sync.server.files) });
}
