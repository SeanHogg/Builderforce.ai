/**
 * The surface header: the status strip (status chip, action button, commit scrubber) over the
 * header row (spine, ask bar, Panels, Risk overlays). It composes the parts and owns none of
 * their state: the panel, the question and the review are the root's, passed down. On a narrow
 * container the overlay menu moves into the strip (see `StatusStrip`, `Toolbar`).
 */

import type { ReactNode } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';

import { Toolbar } from '../Toolbar';
import type { KnowledgeGraphSource, StoredReviewRun, SyncStatus } from '../types';
import type { KnowledgeGraphState } from '../useKnowledgeGraph';
import { OverlayMenu } from './OverlayMenu';
import { PanelToggle, availablePanels } from './PanelDock';
import { PinpointInput } from './PinpointInput';
import type { PanelId } from './panels';
import type { ReviewsTab } from './run/useReviewsTab';
import type { SurfaceEnv } from './registry';
import { StatusStrip } from './StatusStrip';
import { answerFor, answerLine } from './questions';
import { stripAction, syncPill } from './syncPill';
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
    /** The host's sync status, read ONCE by the root (`useSyncStatus`) and shared with the Reviews panel. */
    sync: SyncStatus | null;
    /** The live run record of the open folder: the pace behind the chip's time left, and whether the host runs a review of its own. */
    run: StoredReviewRun | null;
    /** The open folder's name, for "Review {root}". */
    rootTitle: string;
    spine: ReactNode;
    panel: string | null;
    onPanel(id: PanelId | null): void;
    /** Opens the Reviews panel on a tab (the chip and the button). */
    onOpenReviews(tab: ReviewsTab): void;
    history: HistoryRead;
    pickedCommit: string | null;
    /** A commit (or Now = null) was picked; the root also switches the question to "What changed?". */
    onPickCommit(sha: string | null): void;
    changedStations: number;
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

    const overlays = (
        <OverlayMenu
            labels={labels} stations={surface.stations.stations} bindings={surface.overlay.bindings} preset={surface.preset} coverage={surface.coverage}
            onPreset={surface.setPreset} onChannel={surface.setChannel} onPins={surface.setPins} narrow={narrow}
        />
    );
    return (
        <>
            <StatusStrip
                labels={labels} narrow={narrow} pill={pill} action={action} {...(reviewsOpen ? { onOpen: p.onOpenReviews } : {})}
                time={<TimeSlider commits={p.history.commits} capped={p.history.total} picked={p.pickedCommit} labels={labels} onPick={p.onPickCommit} changedStations={p.changedStations} />}
                overlays={overlays}
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
