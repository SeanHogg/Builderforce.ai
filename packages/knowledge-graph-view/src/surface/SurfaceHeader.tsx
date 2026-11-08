/**
 * The surface header: ONE row (`Toolbar`): the spine, the ask bar and, at the right end, the review action (status chip + button, `ReviewAction`). It composes the
 * parts and owns none of their state: the question and the review are the root's, passed down. The Panels group, the Risk overlays menu and the commit scrubber
 * live with the canvas controls (`SceneOverlay`, `SceneTools`).
 */

import type { ReactNode } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';

import { Toolbar } from '../Toolbar';
import type { KnowledgeGraphSource, StoredReviewRun, SyncStatus } from '../types';
import type { KnowledgeGraphState } from '../useKnowledgeGraph';
import { availablePanels } from './PanelDock';
import { PinpointInput } from './PinpointInput';
import type { ReviewsTab } from './run/useReviewsTab';
import type { SurfaceEnv } from './registry';
import { ReviewAction } from './ReviewAction';
import { answerFor, answerLine } from './questions';
import { stripAction, syncPill } from './syncPill';
import type { SurfaceModel } from './useSurface';

export interface SurfaceHeaderProps {
    kg: KnowledgeGraphState;
    source: KnowledgeGraphSource;
    labels: KnowledgeGraphLabels;
    /** The graph drawn (the empty stand-in until one arrives). */
    graph: KnowledgeGraph;
    /** A real graph is on screen. */
    hasGraph: boolean;
    surface: SurfaceModel;
    env: SurfaceEnv;
    narrow: boolean;
    /** The host's sync status, read ONCE by the root (`useSyncStatus`) and shared with the Reviews panel. */
    sync: SyncStatus | null;
    /** The live run record of the open folder: the pace behind the chip's time left, and whether the host runs a review of its own. */
    run: StoredReviewRun | null;
    /** The open folder's name, for "Review {root}". */
    rootTitle: string;
    spine: ReactNode;
    /** Opens the Reviews panel on a tab (the chip and the button). */
    onOpenReviews(tab: ReviewsTab): void;
    /** What `{name}` is in the ask bar's sentence. */
    askName: string;
    linesToggle?: ReactNode;
    onSearch(q: string): void;
    onSelect(ref: string): void;
    onMatches(refs: string[]): void;
    onClear(): void;
    onCompose?: ((text: string) => void) | undefined;
}

export function SurfaceHeader(p: SurfaceHeaderProps) {
    const { kg, source, labels, graph, hasGraph, surface, env, narrow } = p;
    const { sync } = p;
    const lastReviewedAt = kg.scopes.find((s) => s.rootId === kg.rootId)?.lastReviewedAt;
    const pill = syncPill({ labels, review: kg.review.state, stale: kg.stale, refreshFailed: kg.refreshFailed, sync, lastReviewedAt, run: p.run });
    const action = stripAction(labels, pill, hasGraph ? p.rootTitle : undefined);
    // The button always opens the Reviews panel when the host can review or records runs.
    const reviewsOpen = availablePanels(graph, env).some((d) => d.id === 'run');

    return (
        <Toolbar
            labels={labels} narrow={narrow} onSearch={p.onSearch} question={surface.question} askName={p.askName} answer={answerLine(answerFor(surface.question, surface), labels)}
            spine={p.spine} linesToggle={p.linesToggle}
            action={<ReviewAction labels={labels} narrow={narrow} pill={pill} action={action} {...(reviewsOpen ? { onOpen: p.onOpenReviews } : {})} />}
            askWrap={(bar) => (
                <PinpointInput
                    source={source} rootId={kg.rootId} graph={graph} stations={surface.stations} labels={labels} onSelect={p.onSelect} onCompose={p.onCompose}
                    onMatches={p.onMatches} onClear={p.onClear}
                >
                    {bar}
                </PinpointInput>
            )}
        />
    );
}
