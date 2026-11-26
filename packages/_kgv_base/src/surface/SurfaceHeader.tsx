/**
 * The surface header: ONE row (`Toolbar`): Out, the spine, the search (it expands into the ask input), the review status button (`ReviewAction`) and the Panels
 * button that toggles the drawer. It composes the parts and owns none of their state: the question, the review and the drawer are the root's, passed down.
 * The cameras, the questions and the commit scrubber are the scene's toolbar (`SceneOverlay`).
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
import { syncPill } from './syncPill';
import type { SurfaceModel } from './useSurface';

export interface SurfaceHeaderProps {
    kg: KnowledgeGraphState;
    source: KnowledgeGraphSource;
    labels: KnowledgeGraphLabels;
    /** The graph drawn (the empty stand-in until one arrives). */
    graph: KnowledgeGraph;
    surface: SurfaceModel;
    env: SurfaceEnv;
    /** The prototype's ≤900px rules (`layout.drawerSheet`): the header wraps, the spine takes its own row. */
    wrapped: boolean;
    /** The level above and how to climb to it (the drill's out, else the station's line); null ⇒ the Out button is disabled. */
    outTo: string | null;
    onOut(): void;
    /** The drawer: open, and its toggle (the Panels button). */
    drawerOpen: boolean;
    onToggleDrawer(): void;
    /** The Code | Picture switch of the wrapped header. */
    panes?: { code: boolean; onPane(code: boolean): void } | undefined;
    /** The host's sync status, read ONCE by the root (`useSyncStatus`) and shared with the Reviews panel. */
    sync: SyncStatus | null;
    /** The live run record of the open folder: the pace behind the chip's time left, and whether the host runs a review of its own. */
    run: StoredReviewRun | null;
    spine: ReactNode;
    /** Opens the Reviews panel on a tab (the chip and the button). */
    onOpenReviews(tab: ReviewsTab): void;
    /** What `{name}` is in the ask bar's sentence. */
    askName: string;
    linesToggle?: ReactNode;
    /** The host's own tools, first in the right group (the VS Code view switch). */
    headerTools?: ReactNode;
    onSearch(q: string): void;
    onSelect(ref: string): void;
    onMatches(refs: string[]): void;
    onClear(): void;
    onCompose?: ((text: string) => void) | undefined;
}

export function SurfaceHeader(p: SurfaceHeaderProps) {
    const { kg, source, labels, graph, surface, env, wrapped } = p;
    const { sync } = p;
    const lastReviewedAt = kg.scopes.find((s) => s.rootId === kg.rootId)?.lastReviewedAt;
    const pill = syncPill({ labels, review: kg.review.state, stale: kg.stale, refreshFailed: kg.refreshFailed, sync, lastReviewedAt, run: p.run });
    // The status button opens the Review tab when the host can review or records runs.
    const reviewsOpen = availablePanels(graph, env).some((d) => d.id === 'run');

    return (
        <Toolbar
            labels={labels} wrapped={wrapped} onSearch={p.onSearch} question={surface.question} askName={p.askName} outTo={p.outTo} onOut={p.onOut}
            spine={p.spine} linesToggle={p.linesToggle} headerTools={p.headerTools} drawerOpen={p.drawerOpen} onToggleDrawer={p.onToggleDrawer} panes={p.panes}
            action={<ReviewAction labels={labels} narrow={wrapped} pill={pill} {...(reviewsOpen ? { onOpen: p.onOpenReviews } : {})} />}
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
