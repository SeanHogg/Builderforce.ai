/**
 * The status strip's readings, as pure functions: the sync pill (state + words) from the review
 * run, the hook's stale / refresh-failed flags and what the host reports about the server, and
 * the parity line ("15,994 files here and on the server"). React-free: the one read of
 * `source.syncStatus` is the hook in `useSyncStatus.ts`.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { reviewProgressText } from '../reviewProgressText';
import { counted } from './plural';
import type { SyncStatus } from '../types';
import type { ReviewState } from '../useReviewRun';
import type { StatusState } from './ui';

export interface SyncPill {
    state: StatusState;
    text: string;
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

export function syncPill({ labels, review, stale, refreshFailed, sync, lastReviewedAt, now }: SyncPillInput): SyncPill {
    const h = labels.surface.header;
    if (review.status === 'planning' || review.status === 'running') {
        return { state: 'syncing', text: fillTemplate(h.reviewing, { progress: reviewProgressText(labels, review.status === 'running' ? review.progress : undefined) }) };
    }
    if (review.status === 'confirm') return { state: 'syncing', text: h.reviewPlan };
    if (review.status === 'error') return { state: 'error', text: h.reviewFailed };
    if (refreshFailed) return { state: 'error', text: h.updateFailed };
    if (stale) return { state: 'syncing', text: labels.refreshing };
    if (sync?.skipped && sync.skipped.length > 0) return { state: 'error', text: counted(labels, 'fileNotStored', sync.skipped.length) };
    // No snapshot on this machine is not a fault: the folder was reviewed on the server only (the parity line says the same).
    if (sync && hasNoLocalSnapshot(sync)) return { state: 'serverOnly', text: labels.surface.pillStates.serverOnly };
    // The map is local; the replica is what the project has not received yet (PRD 41 A7).
    if (sync?.replica && sync.replica.failed.length > 0) return { state: 'error', text: counted(labels, 'replicaFailed', sync.replica.failed.length) };
    if (sync?.replica && sync.replica.queued > 0) return { state: 'syncing', text: counted(labels, 'replicaQueued', sync.replica.queued) };
    if (sync?.server && sync.server.files !== sync.local.files) return { state: 'partial', text: labels.surface.pillStates.partial };
    // Never "Synced" while the local side holds no files: nothing here is in step with anything.
    if (sync && sync.local.files === 0) return { state: 'idle', text: h.notSynced };
    if (sync || lastReviewedAt) {
        const when = lastReviewedAt ? relativeTime(lastReviewedAt, now) : '';
        return { state: 'synced', text: when ? fillTemplate(h.syncedAt, { time: when }) : h.synced };
    }
    return { state: 'idle', text: h.notSynced };
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
