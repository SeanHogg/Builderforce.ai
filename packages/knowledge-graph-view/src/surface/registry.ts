/**
 * The surface's two registries are DATA: a camera (a way to draw the graph) and a panel (a
 * drawer opened from the header) are each a row with an id, the label key naming it, the
 * component that renders it and an `available(graph, env)` rule. The root composes whatever
 * the arrays hold and never names a camera or a panel, so adding one is a row in
 * `cameras.tsx` / `panels.ts` (plus its id in `ViewMode` for a camera) and nothing else.
 */

import type { ComponentType } from 'react';
import type { Finding, KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels, StringLabelKey } from '../labels';
import type { LensDef } from '../lenses';
import type { Revision } from '../revision';
import type { FindingEvidence, KnowledgeGraphSource, SourceLocation, SyncStatus, ViewMode } from '../types';
import type { RunPanelData } from './run/useReviewRunRecord';
import type { HistoryRead } from './TimeSlider';
import type { Diagnostics } from '../diagnosticSection';
import type { ReviewsTabState } from './run/useReviewsTab';
import type { SurfaceModel } from './useSurface';

/** What a row's `available` rule may depend on. */
export interface SurfaceEnv {
    webgl: boolean;
    reducedMotion: boolean;
    /** The graph has entry points, so the transit map has lines to draw. */
    hasLines: boolean;
    compact: boolean;
    /** The source records its reviews as runs, so the Run drawer has something to show. */
    hasRun?: boolean;
}

/** Everything a camera is handed; a camera takes what it draws from here. */
export interface SceneProps {
    mode: ViewMode;
    graph: KnowledgeGraph;
    /** What is drawn: the focused nodes and the lens's edges. */
    drawn: { nodes: KNode[]; edges: KEdge[] };
    lens: LensDef;
    labels: KnowledgeGraphLabels;
    rootTitle: string;
    selected: string | null;
    focus: readonly string[];
    reducedMotion: boolean;
    /** The stations, lines, overlay bindings, question and selection every camera reads. */
    surface: SurfaceModel;
    onSelect(ref: string): void;
    onShow(refs: string[]): void;
    /** Switches the camera (the System camera's "+N more" opens the List). Absent = the host cannot switch. */
    onCamera?: ((mode: ViewMode) => void) | undefined;
    onCompose?: ((text: string) => void) | undefined;
    evidence?: ((f: Finding) => FindingEvidence[]) | undefined;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
}

export interface CameraDef {
    id: ViewMode;
    /** The `KnowledgeGraphLabels` key holding the button's name. */
    labelKey: StringLabelKey;
    component: ComponentType<SceneProps>;
    available(graph: KnowledgeGraph, env: SurfaceEnv): boolean;
    /** False = no button in the scene overlay's View group (the camera is drawn by something else, e.g. the path strip). Default true. */
    switcher?: boolean;
}

/** What a drawer is handed. */
export interface PanelProps {
    graph: KnowledgeGraph;
    /** The host's source: a drawer reads the optional methods it needs (`syncStatus`, `applyFix`) and shows nothing when absent. */
    source?: KnowledgeGraphSource | undefined;
    rootId?: string | undefined;
    /** The reviewed folder's title (names the exported OpenAPI and Postman documents). */
    rootTitle?: string | undefined;
    /** Reloads the graph after a drawer changed the code (Resolve applied a codemod). */
    onChanged?: (() => void) | undefined;
    /** The *Copy diagnostics* text of the view, for the Sync drawer. */
    diagnosticsText?: (() => string) | undefined;
    /** The diagnostics once: the groups the Diagnostics tab shows and the text Copy diagnostics copies. */
    diagnostics?: (() => Diagnostics) | undefined;
    /** The host's sync status, read ONCE by the root (`useSyncStatus`); the Sync drawer draws it and fetches nothing. */
    sync?: SyncStatus | null | undefined;
    /** The root's ONE history read (the time slider's); the Server tab's commits-since-the-last-review feed draws it and fetches nothing. */
    history?: HistoryRead | undefined;
    /** Starts the view's review flow again for this root, forcing every file (the confirm still asks); absent when the host cannot review. */
    onResendSkipped?: (() => void) | undefined;
    /** The review's run record and the review state machine, for the Run drawer (PRD 41 A8). */
    runs?: RunPanelData | undefined;
    /** The Reviews panel's open tab and how to change it (the root keeps it per folder, so closing the panel forgets nothing). */
    reviews?: ReviewsTabState | undefined;
    /** When the root was last reviewed (the Review tab and the status line). */
    lastReviewedAt?: string | undefined;
    labels: KnowledgeGraphLabels;
    surface: SurfaceModel;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
    /** Before/After, when the host keeps a baseline; the Resolve flow repeats the header menu's toggle. */
    revision?: { value: Revision; hasBefore: boolean; onChange(r: Revision): void } | undefined;
    /** Switches the scene (Patterns: Show in Tower). `cameras` are the ones available now. */
    onCamera?: ((mode: ViewMode) => void) | undefined;
    cameras?: readonly ViewMode[] | undefined;
    onClose(): void;
}

export interface PanelDef {
    id: string;
    labelKey: StringLabelKey;
    component: ComponentType<PanelProps>;
    available(graph: KnowledgeGraph, env: SurfaceEnv): boolean;
    /** The panel lays out its own scroller and pinned footer (the Reviews panel): the host panel gives it the whole body, no padding. */
    fill?: boolean;
}
