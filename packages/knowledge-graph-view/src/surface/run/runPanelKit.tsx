/**
 * Shared by the Reviews panel's tests (not shipped). Like `testReviews.ts`, it takes the test libraries INJECTED (`fn`: vitest's `vi.fn`, `act` and `screen`: testing-library's), so this
 * module imports neither: a review machine, a runs port, a sync status, a diagnostics source and a harness that holds the root's tab and Retry upload the way the view does.
 */

import { useState } from 'react';
import type { Diagnostics } from '../../diagnosticSection';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { KnowledgeGraphSource, ReviewRunsPort, StoredReviewRun, SyncStatus } from '../../types';
import type { ReviewRun as ReviewMachine } from '../../useReviewRun';
import type { PanelProps } from '../registry';
import type { HistoryRead } from '../TimeSlider';
import { RunPanel } from './RunPanel';
import { RetryUploadContext, useRetryUploadState } from './useRetryUpload';
import { useReviewRunRecord } from './useReviewRunRecord';
import { useReviewsTab } from './useReviewsTab';

export const r = L.surface.run.review;

export const sync = (over: Partial<SyncStatus> = {}): SyncStatus => ({ local: { files: 120, docs: 0 }, server: { files: 100, docs: 0 }, sources: [], ...over });

export const DIAG = 'Knowledge graph diagnostics\nstatus: ready\nreview: idle\nsync: local=120 server=100 files\ntime: now';

/** A diagnostics source: the review group holds a failure (so it opens first), the others are quiet. */
export const diagnosticsOf = (over: Partial<Diagnostics> = {}) => (): Diagnostics => ({
    takenAt: '2026-11-07T10:20:30.000Z', text: DIAG,
    sections: [
        { id: 'graph', lines: ['status: ready', 'lens: structure'], attention: false },
        { id: 'review', lines: ['review: error', 'run errors: extractErrors=1 failures=2'], attention: true },
        { id: 'sync', lines: ['sync: local=120 server=100 files'], attention: false },
    ],
    ...over,
});

/** vitest's `vi.fn`, as far as the kit needs it. */
type Spy = <T extends (...args: never[]) => unknown>(impl?: T) => T;
interface Injected {
    fn: Spy;
    act: (cb: () => void) => unknown;
    screen: { getByRole(role: 'tab', options: { name: RegExp }): HTMLElement; getByTestId(id: string): HTMLElement };
}

export interface HarnessProps {
    port: ReviewRunsPort;
    review: ReviewMachine;
    sync?: SyncStatus | null;
    canReview?: boolean;
    diagnostics?: (() => Diagnostics) | undefined;
    revision?: PanelProps['revision'];
    lastReviewedAt?: string;
    retrySync?: KnowledgeGraphSource['retrySync'];
    /** The root's history read the Server tab's commit feed draws; `withHistory` says the source keeps one. */
    history?: HistoryRead | undefined;
    withHistory?: boolean;
    onCompose?: ((text: string) => void) | undefined;
    onResendSkipped?: (() => void) | undefined;
    openPanel?: ((id: string | null) => void) | undefined;
}

export function createKit({ fn, act, screen }: Injected) {
    const machine = (state: ReviewMachine['state'] = { status: 'running' }): ReviewMachine => ({
        state, available: true, start: fn(() => undefined), answer: fn(() => undefined), rereviewAll: fn(() => undefined), stop: fn(() => undefined),
        forceStop: fn(() => undefined), dismiss: fn(() => undefined),
    });

    const portOf = (over: Partial<ReviewRunsPort> = {}) => {
        const listeners = new Set<(run: StoredReviewRun) => void>();
        const port: ReviewRunsPort = {
            subscribe: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
            list: fn(async () => []), get: fn(async () => null), stop: fn(async () => undefined), ...over,
        };
        return { port, push: (run: StoredReviewRun) => act(() => listeners.forEach((l) => l(run))) };
    };

    /** The root keeps the tab per folder and provides Retry upload; the `toggle` button mounts and unmounts the panel as the real drawer does. */
    function Harness({ port, review, sync: syncStatus = null, canReview = true, diagnostics = diagnosticsOf(), revision, lastReviewedAt, retrySync, history, withHistory = false, onCompose, onResendSkipped, openPanel }: HarnessProps) {
        const source = { runs: port, ...(withHistory ? { history: async () => ({ commits: [] }) } : {}), ...(retrySync ? { retrySync } : {}), ...(canReview ? { review: () => (async function* () { /* never started here */ })() } : {}) } as unknown as KnowledgeGraphSource;
        const read = useReviewRunRecord(source, 'docs', true);
        const reviews = useReviewsTab('docs');
        const retryUpload = useRetryUploadState(source, 'docs', () => undefined);
        const [open, setOpen] = useState(true);
        return (
            <RetryUploadContext.Provider value={retryUpload}>
                <button type="button" onClick={() => setOpen((v) => !v)}>toggle</button>
                <div style={{ height: 600 }}>
                    {open && <RunPanel {...({ labels: L, source, rootId: 'docs', rootTitle: 'Docs', runs: { read, review }, reviews, sync: syncStatus, diagnostics, revision, lastReviewedAt, history, onCompose, onResendSkipped, surface: { openPanel: openPanel ?? fn(() => undefined) } } as unknown as PanelProps)} />}
                </div>
            </RetryUploadContext.Provider>
        );
    }

    const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
    const footer = () => screen.getByTestId('kg-footer-action') as HTMLButtonElement;
    return { machine, portOf, Harness, tab, footer };
}
