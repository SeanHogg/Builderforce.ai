/**
 * The surface header: the status strip (sync pill, parity, commit scrubber, ⋯ menu) over the
 * header row (spine, ask bar, Panels, Risk overlays). It composes the parts and owns none of
 * their state: the panel, the question and the review are the root's, passed down. On a narrow
 * container the overlay menu moves into the strip (see `StatusStrip`, `Toolbar`).
 */

import type { ReactNode } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';
import type { Revision } from '../revision';
import { Toolbar } from '../Toolbar';
import type { KnowledgeGraphSource, ReviewRequest, ReviewTarget, SyncStatus } from '../types';
import type { KnowledgeGraphState } from '../useKnowledgeGraph';
import { OverflowMenu } from './OverflowMenu';
import { OverlayMenu } from './OverlayMenu';
import { PanelToggle, availablePanels } from './PanelDock';
import { PinpointInput } from './PinpointInput';
import type { PanelId } from './panels';
import type { SurfaceEnv } from './registry';
import { StatusStrip } from './StatusStrip';
import { answerFor, answerLine } from './questions';
import { parityText, syncPill } from './syncPill';
import { TimeSlider, type HistoryRead } from './TimeSlider';
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
    /** The Panels group is one "Panels ▾" menu (`layoutOf(width).panelsMenu`). */
    panelsMenu: boolean;
    /** The host's review places, read ONCE by the root (`useReviewTargets`). */
    targets: readonly ReviewTarget[];
    /** The host's sync status, read ONCE by the root (`useSyncStatus`) and shared with the scene's missing-files banner. */
    sync: SyncStatus | null;
    spine: ReactNode;
    /** The ReviewProgress card, which the sync pill opens. */
    reviewCard: ReactNode;
    panel: string | null;
    onPanel(id: PanelId | null): void;
    history: HistoryRead;
    pickedCommit: string | null;
    /** A commit (or Now = null) was picked; the root also switches the question to "What changed?". */
    onPickCommit(sha: string | null): void;
    changedStations: number;
    /** Present when the host keeps a baseline. */
    revision?: { value: Revision; hasBefore: boolean; onChange(r: Revision): void } | undefined;
    diagnosticsText(): string;
    /** What `{name}` is in the ask bar's sentence. */
    askName: string;
    linesToggle?: ReactNode;
    onSearch(q: string): void;
    onSelect(ref: string): void;
    onMatches(refs: string[]): void;
    onClear(): void;
    onCompose?: ((text: string) => void) | undefined;
    /** Open the ⋯ menu on its review action (a host's "Choose a folder to review" chip). */
    openReview?: boolean | undefined;
}

export function SurfaceHeader(p: SurfaceHeaderProps) {
    const { kg, source, labels, graph, hasGraph, surface, env, narrow } = p;
    const { sync } = p;
    const lastReviewedAt = kg.scopes.find((s) => s.rootId === kg.rootId)?.lastReviewedAt;
    const pill = syncPill({ labels, review: kg.review.state, stale: kg.stale, refreshFailed: kg.refreshFailed, sync, lastReviewedAt });
    const syncOpens = hasGraph && availablePanels(graph, env).some((d) => d.id === 'sync');

    const overlays = (
        <OverlayMenu
            labels={labels} stations={surface.stations.stations} bindings={surface.overlay.bindings} preset={surface.preset} coverage={surface.coverage}
            onPreset={surface.setPreset} onChannel={surface.setChannel} onPins={surface.setPins} narrow={narrow}
        />
    );
    return (
        <>
            <StatusStrip
                labels={labels} narrow={narrow} pill={pill} parity={parityText(labels, sync)} reviewStatus={kg.review.state.status} reviewCard={p.reviewCard}
                onSync={syncOpens ? () => p.onPanel('sync') : undefined}
                time={<TimeSlider commits={p.history.commits} capped={p.history.total} picked={p.pickedCommit} labels={labels} onPick={p.onPickCommit} changedStations={p.changedStations} />}
                overlays={overlays}
                overflow={(
                    <OverflowMenu
                        source={source} labels={labels} rootId={hasGraph ? kg.rootId : null} canReview={hasGraph || kg.status === 'load-failed' || kg.status === 'error'}
                        reviewStatus={kg.review.state.status} onReview={(req: ReviewRequest) => kg.review.start(req)} revision={p.revision}
                        diagnosticsText={p.diagnosticsText} targets={p.targets} openReview={p.openReview}
                    />
                )}
            />
            <Toolbar
                labels={labels} narrow={narrow} onSearch={p.onSearch} question={surface.question} askName={p.askName} answer={answerLine(answerFor(surface.question, surface), labels)}
                spine={p.spine} linesToggle={p.linesToggle} overlays={overlays}
                panels={<PanelToggle graph={graph} env={env} labels={labels} panel={p.panel} onPanel={p.onPanel} collapsed={p.panelsMenu && !narrow} />}
                askWrap={(bar) => (
                    <PinpointInput
                        source={source} rootId={kg.rootId} graph={graph} stations={surface.stations} labels={labels} onSelect={p.onSelect} onCompose={p.onCompose}
                        onMatches={p.onMatches} onClear={p.onClear}
                    >
                        {bar}
                    </PinpointInput>
                )}
            />
        </>
    );
}
