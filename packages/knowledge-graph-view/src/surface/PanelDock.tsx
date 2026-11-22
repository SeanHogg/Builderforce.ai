/**
 * The header's "Panels" group and the drawer it opens. Both are CONTROLLED by the surface
 * (`surface.panel` / `surface.openPanel`), so the Act rail and the path strip can open a drawer
 * the same way a button does. `PanelToggle` is the Segmented group (Coverage, Patterns, API,
 * Sync: only those available for this graph); `PanelDrawer` shows the open panel in the host's
 * side panel (or the package's 500px sheet; a bottom sheet when compact).
 */

import type { CSSProperties, ReactNode } from 'react';
import { iconButtonStyle } from './CameraBar';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';
import { Panel } from '../Sheet';
import { cssVar } from '../scene/themeColors';
import type { KnowledgeGraphSource, KnowledgePanelRenderer, ViewMode } from '../types';
import { HEADER_PANELS, PANELS, type PanelId } from './panels';
import type { PanelDef, PanelProps, SurfaceEnv } from './registry';
import type { PanelSlot } from './usePanelVisibility';
import type { SyncRead } from './useSyncStatus';
import { Menu, Segmented } from './ui';
import type { SurfaceModel } from './useSurface';

/** The panels of the registry that are available for this graph. */
export const availablePanels = (graph: KnowledgeGraph, env: SurfaceEnv, panels: readonly PanelDef[] = PANELS): PanelDef[] =>
    panels.filter((p) => p.available(graph, env));

export interface PanelToggleProps {
    graph: KnowledgeGraph;
    env: SurfaceEnv;
    labels: KnowledgeGraphLabels;
    /** The open drawer's id; null = none. */
    panel: string | null;
    onPanel(id: PanelId | null): void;
    /** Overrides the registry (tests); the app uses the real one. */
    panels?: readonly PanelDef[];
    /** The ids that get a button, in order (default: the header's four). */
    ids?: readonly string[];
    /** Too little room for the group (see `layout.ts`): it becomes one "Panels ▾" menu, same panels, same open state. */
    collapsed?: boolean;
}

function Glyph({ children }: { children: ReactNode }) {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ display: 'block', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            {children}
        </svg>
    );
}

/** One icon per header panel. The accessible name stays the localized label. */
function panelGlyph(id: string): ReactNode {
    if (id === 'coverage') return <Glyph><path d="M8 2.5 13 4.5v4c0 3-2.2 4.6-5 5.5-2.8-.9-5-2.5-5-5.5v-4l5-2z" /></Glyph>;
    if (id === 'patterns') return <Glyph><path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z" /></Glyph>;
    if (id === 'api') return <Glyph><path d="M6 3c-1 0-1.5.5-1.5 1.5v2C4.5 7.5 4 8 3 8c1 0 1.5.5 1.5 1.5v2C4.5 12.5 5 13 6 13M10 3c1 0 1.5.5 1.5 1.5v2c0 1 .5 1.5 1.5 1.5-1 0-1.5.5-1.5 1.5v2c0 1-.5 1.5-1.5 1.5" /></Glyph>;
    if (id === 'agentRuns') return <Glyph><rect x="3.5" y="5.5" width="9" height="7" rx="1.5" /><path d="M8 5.5V3.3M6 8.5v1M10 8.5v1" /><circle cx="8" cy="2.5" r="0.8" /></Glyph>;
    if (id === 'run') return <Glyph><path d="M6 4.5v7l6-3.5-6-3.5z" /></Glyph>;
    return <Glyph><path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h10v4H3z" /></Glyph>;
}

const clipLabel: CSSProperties = {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0,
};

export function PanelToggle({ graph, env, labels, panel, onPanel, panels = PANELS, ids = HEADER_PANELS, collapsed = false }: PanelToggleProps) {
    const available = availablePanels(graph, env, panels);
    const items = ids.flatMap((id) => {
        const def = available.find((p) => p.id === id);
        if (!def) return [];
        const label = labels[def.labelKey];
        return [{ id: def.id, label, title: label, glyph: panelGlyph(def.id) }];
    });
    if (items.length === 0) return null;
    if (collapsed) {
        const name = labels.surface.panelsLabel;
        return (
            <Menu
                label={name} triggerLabel={name} title={name} active={items.some((i) => i.id === panel)}
                triggerStyle={{ ...iconButtonStyle, position: 'relative' }}
                trigger={<><Glyph><path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h10v4H3z" /></Glyph><span style={clipLabel}>{name}</span></>}
                items={items.map((i) => ({ id: i.id, label: i.label, selected: i.id === panel }))} onSelect={(id) => onPanel(id === panel ? null : (id as PanelId))}
            />
        );
    }
    return (
        <Segmented
            mode="toggle" label={labels.surface.panelsLabel} items={items} value={items.some((i) => i.id === panel) ? panel : null}
            onChange={(id) => onPanel(id as PanelId | null)}
        />
    );
}

export interface PanelDrawerProps {
    graph: KnowledgeGraph;
    env: SurfaceEnv;
    labels: KnowledgeGraphLabels;
    surface: SurfaceModel;
    panel: string | null;
    onPanel(id: PanelId | null): void;
    renderPanel?: KnowledgePanelRenderer | undefined;
    source?: KnowledgeGraphSource | undefined;
    rootId?: string | undefined;
    rootTitle?: string | undefined;
    onChanged?: (() => void) | undefined;
    diagnostics?: PanelProps['diagnostics'];
    /** The root's ONE sync read (`useSyncStatus`), handed to the Sync drawer. */
    sync?: SyncRead | undefined;
    /** The Run drawer's data (the review's run record, read once by the root). */
    runs?: PanelProps['runs'];
    /** The Reviews panel's tab state (the root's). */
    reviews?: PanelProps['reviews'];
    lastReviewedAt?: string | undefined;
    history?: PanelProps['history'];
    onResendSkipped?: (() => void) | undefined;
    onCamera?: ((mode: ViewMode) => void) | undefined;
    cameras?: readonly ViewMode[] | undefined;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
    /** Before/After for the Resolve flow (the same state as the header menu). */
    revision?: PanelProps['revision'];
    /** Overrides the registry (tests); the app uses the real one. */
    panels?: readonly PanelDef[];
}

/** A collapsed dock keeps this much of itself: a thin rail the edge chevron sits on. */
export const DOCK_RAIL = 28;

const TOGGLE_NAMES = {
    left: ['showLeft', 'hideLeft'], bottom: ['showBottom', 'hideBottom'], right: ['showRight', 'hideRight'],
} as const;

/** Points toward the edge the dock collapses to, and back into the scene when it is a rail. */
function chevronGlyph(slot: PanelSlot, shown: boolean, below: boolean): string {
    if (slot === 'bottom' || below) return shown ? '▾' : '▴';
    return slot === 'left' ? (shown ? '‹' : '›') : (shown ? '›' : '‹');
}

export interface DockEdgeProps {
    slot: PanelSlot;
    /** Open (the panel) or collapsed (the rail). The same flag `usePanelVisibility` stores. */
    shown: boolean;
    onToggle(id: PanelSlot): void;
    labels: KnowledgeGraphLabels;
    /** The dock sits under the scene (the Act rail on a narrow layout, or the stacked lines list): the rail is a strip, the chevron on its top edge. */
    below?: boolean;
    children: ReactNode;
}

/**
 * The edge of a side dock (left lines, bottom path strip, right act panel). The chevron on the edge toward the scene
 * collapses the dock to a thin rail and re-expands it. Names come from `labels.surface.panelToggles`.
 */
export function DockEdge({ slot, shown, onToggle, labels, below = false, children }: DockEdgeProps) {
    const t = labels.surface.panelToggles;
    const name = t[TOGGLE_NAMES[slot][shown ? 1 : 0]];
    const horizontal = slot === 'bottom' || below;
    const rail: CSSProperties = horizontal
        ? { height: DOCK_RAIL, width: '100%', borderTop: `1px solid ${cssVar('border')}` }
        : {
            width: DOCK_RAIL, alignSelf: 'stretch',
            ...(slot === 'left' ? { borderInlineEnd: `1px solid ${cssVar('border')}` } : { borderInlineStart: `1px solid ${cssVar('border')}` }),
        };
    // Inset on the inner edge so a parent that clips overflow, or the scene beside it, cannot cover the control.
    const place: CSSProperties = !shown
        ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
        : horizontal
            ? { top: 4, left: '50%', transform: 'translateX(-50%)' }
            : slot === 'left'
                ? { top: '50%', right: 4, transform: 'translateY(-50%)' }
                : { top: '50%', left: 4, transform: 'translateY(-50%)' };
    return (
        <div
            data-panel-dock={slot} data-collapsed={shown ? 'false' : 'true'}
            style={{
                position: 'relative', display: 'flex', flex: 'none', minWidth: 0, minHeight: 0,
                flexDirection: horizontal ? 'column' : 'row',
                ...(shown ? null : { ...rail, background: cssVar('panel') }),
            }}
        >
            <button
                type="button" data-panel-edge={slot} aria-expanded={shown} aria-label={name} title={name} onClick={() => onToggle(slot)}
                style={{
                    ...place, position: 'absolute', zIndex: 1, width: 22, height: 22, padding: 0, display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', font: 'inherit', lineHeight: 1,
                    border: `1px solid ${cssVar('border')}`, background: cssVar('panel'), color: cssVar('text'),
                }}
            >
                <span aria-hidden="true">{chevronGlyph(slot, shown, below)}</span>
            </button>
            {shown ? children : null}
        </div>
    );
}

export function PanelDrawer({
    graph, env, labels, surface, panel, onPanel, renderPanel, source, rootId, rootTitle, onChanged, diagnostics, sync, history, runs, reviews, lastReviewedAt, onResendSkipped, onCamera, cameras, onShow, onCompose, revision, panels = PANELS,
}: PanelDrawerProps) {
    const open = availablePanels(graph, env, panels).find((p) => p.id === panel) ?? null;
    const Body = open?.component;
    const subtitle = open ? (labels.surface.drawerSubtitle as Record<string, string | undefined>)[open.id] : undefined;
    return (
        <Panel render={renderPanel} open={!!open} compact={env.compact} closeLabel={labels.close} title={open ? (open.id === 'run' && rootTitle ? rootTitle : labels[open.labelKey]) : ''} subtitle={subtitle} fill={open?.fill === true} width={500} onClose={() => onPanel(null)}>
            {Body && <Body graph={graph} source={source} rootId={rootId} rootTitle={rootTitle} onChanged={onChanged} diagnostics={diagnostics} sync={sync?.status} history={history} runs={runs} reviews={reviews} lastReviewedAt={lastReviewedAt} onResendSkipped={onResendSkipped} onCamera={onCamera} cameras={cameras} labels={labels} surface={surface} onShow={onShow} onCompose={onCompose} revision={revision} onClose={() => onPanel(null)} />}
        </Panel>
    );
}
