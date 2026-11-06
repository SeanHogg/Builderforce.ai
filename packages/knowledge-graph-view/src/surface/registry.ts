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
import type { FindingEvidence, KnowledgeGraphSource, SourceLocation, ViewMode } from '../types';
import type { SurfaceModel } from './useSurface';

/** What a row's `available` rule may depend on. */
export interface SurfaceEnv {
    webgl: boolean;
    reducedMotion: boolean;
    /** The graph has entry points, so the transit map has lines to draw. */
    hasLines: boolean;
    compact: boolean;
    /** The source can report its sync status, so the Sync drawer has something to show. */
    hasSync?: boolean;
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
    labels: KnowledgeGraphLabels;
    surface: SurfaceModel;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
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
}
