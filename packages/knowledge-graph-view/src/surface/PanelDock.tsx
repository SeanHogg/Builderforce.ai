/**
 * The header's "Panels" group and the drawer it opens. Both are CONTROLLED by the surface
 * (`surface.panel` / `surface.openPanel`), so the Act rail and the path strip can open a drawer
 * the same way a button does. `PanelToggle` is the Segmented group (Coverage, Patterns, API,
 * Sync: only those available for this graph); `PanelDrawer` shows the open panel in the host's
 * side panel (or the package's 500px sheet; a bottom sheet when compact).
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';
import { Panel } from '../Sheet';
import type { KnowledgeGraphSource, KnowledgePanelRenderer, ViewMode } from '../types';
import { HEADER_PANELS, PANELS, type PanelId } from './panels';
import type { PanelDef, PanelProps, SurfaceEnv } from './registry';
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

export function PanelToggle({ graph, env, labels, panel, onPanel, panels = PANELS, ids = HEADER_PANELS, collapsed = false }: PanelToggleProps) {
    const available = availablePanels(graph, env, panels);
    const items = ids.flatMap((id) => {
        const def = available.find((p) => p.id === id);
        return def ? [{ id: def.id, label: labels[def.labelKey] }] : [];
    });
    if (items.length === 0) return null;
    if (collapsed) {
        return (
            <Menu
                label={labels.surface.panelsLabel} active={items.some((i) => i.id === panel)} trigger={<>{labels.surface.panelsLabel}<span aria-hidden="true"> ▾</span></>}
                items={items.map((i) => ({ ...i, selected: i.id === panel }))} onSelect={(id) => onPanel(id === panel ? null : (id as PanelId))}
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
