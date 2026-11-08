/**
 * The Reviews panel's wiring in the view, in one place: its tab (remembered per folder), the run record, Retry upload, how a drawer is opened and closed, and when a
 * review that started somewhere else shows itself.
 *
 *   - Closing the panel while a plan awaits its answer cancels it (nothing is written). Closing it while the files are still being counted means "not now": the plan
 *     is discarded (answered no) the moment it lands, and the panel does not pop back open.
 *   - A review started elsewhere (the empty state's launcher, a copy fix) opens the panel on Review for its plan and its run, but only over NO other drawer: a drawer the
 *     person is reading is never taken from them. A review started from the panel itself finds it open already.
 *   - A host's "Choose a folder to review" chip (`openReview`) arrives on the panel.
 */

import { useEffect, useRef } from 'react';
import type { KnowledgeGraphSource } from '../../types';
import type { KnowledgeGraphState } from '../../useKnowledgeGraph';
import type { SurfaceModel } from '../useSurface';
import { useRetryUploadState, type RetryUpload } from './useRetryUpload';
import { useReviewRunRecord, type RunPanelData, type RunRecordRead } from './useReviewRunRecord';
import { useReviewsTab, type ReviewsTab, type ReviewsTabState } from './useReviewsTab';

export interface ReviewsPanelArgs {
    kg: KnowledgeGraphState;
    surface: SurfaceModel;
    source: KnowledgeGraphSource;
    /** The host keeps a baseline, so the panel (its Server tab holds Before / After) exists even where nothing can be reviewed. */
    keepsBaseline: boolean;
    /** Reads the sync status again (after a retry settles). */
    refreshSync(): void;
    openReview?: boolean | undefined;
}

export interface ReviewsPanel {
    reviews: ReviewsTabState;
    /** Present only when the source can retry an upload. */
    retryUpload: RetryUpload | undefined;
    runRead: RunRecordRead;
    /** What the panel is handed; absent ⇒ the host has no panel to show. */
    runs: RunPanelData | undefined;
    /** The surface's `openPanel`, with the Reviews panel's closing rules. */
    setPanel(id: string | null): void;
    openReviews(tab?: ReviewsTab): void;
}

export function useReviewsPanel({ kg, surface, source, keepsBaseline, refreshSync, openReview }: ReviewsPanelArgs): ReviewsPanel {
    const panel = surface.panel;
    const status = kg.review.state.status;
    const reviews = useReviewsTab(kg.rootId);
    const retryUpload = useRetryUploadState(source, kg.rootId, refreshSync);
    const hasReviews = !!source.runs || !!source.review;
    const runRead = useReviewRunRecord(source, kg.rootId, panel === 'run');
    const runs = hasReviews || keepsBaseline ? { read: runRead, review: kg.review } : undefined;

    const closedWhileCounting = useRef(false);
    const setPanel = (id: string | null) => {
        if (panel === 'run' && id !== 'run') {
            if (status === 'confirm') kg.review.answer(false);
            if (status === 'planning') closedWhileCounting.current = true;
        }
        surface.openPanel(id);
    };
    const openReviews = (tab?: ReviewsTab) => { if (tab) reviews.setTab(tab); setPanel('run'); };

    // Read at the moment the status changes, not captured: the drawer open NOW decides whether a review may take the screen.
    const panelNow = useRef(panel);
    panelNow.current = panel;
    const openPanel = useRef(surface.openPanel);
    openPanel.current = surface.openPanel;
    const discardPlan = useRef(kg.review.answer);
    discardPlan.current = kg.review.answer;
    const setTab = reviews.setTab;
    useEffect(() => {
        if (!hasReviews) return;
        if (status === 'confirm' && closedWhileCounting.current) { closedWhileCounting.current = false; discardPlan.current(false); return; }
        if ((status === 'running' || status === 'confirm') && panelNow.current === null) { setTab('review'); openPanel.current('run'); }
        if (status === 'idle' || status === 'cancelled' || status === 'done' || status === 'error' || status === 'aborted') closedWhileCounting.current = false;
    }, [status, hasReviews, setTab]);
    useEffect(() => { if (openReview && source.review) { setTab('review'); openPanel.current('run'); } }, [openReview, source.review, setTab]);

    return { reviews, retryUpload, runRead, runs, setPanel, openReviews };
}
