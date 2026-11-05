/**
 * The header's panel buttons and the drawer they open. It reads the panel registry, draws
 * a button for each panel available for this graph, and shows the open one in the host's
 * side panel (or the package's sheet; a bottom sheet when compact). With no panels it
 * renders nothing at all.
 */

import { useState } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';
import { Panel } from '../Sheet';
import { chip } from '../styles';
import type { KnowledgeGraphSource, KnowledgePanelRenderer, ViewMode } from '../types';
import { PANELS } from './panels';
import type { PanelDef, SurfaceEnv } from './registry';
import type { SurfaceModel } from './useSurface';

export interface PanelDockProps {
    graph: KnowledgeGraph;
    env: SurfaceEnv;
    labels: KnowledgeGraphLabels;
    surface: SurfaceModel;
    renderPanel?: KnowledgePanelRenderer | undefined;
    source?: KnowledgeGraphSource | undefined;
    rootId?: string | undefined;
    rootTitle?: string | undefined;
    onChanged?: (() => void) | undefined;
    diagnosticsText?: (() => string) | undefined;
    onCamera?: ((mode: ViewMode) => void) | undefined;
    cameras?: readonly ViewMode[] | undefined;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
    /** Overrides the registry (tests); the app uses the real one. */
    panels?: readonly PanelDef[];
}

export function PanelDock({ graph, env, labels, surface, renderPanel, source, rootId, rootTitle, onChanged, diagnosticsText, onCamera, cameras, onShow, onCompose, panels = PANELS }: PanelDockProps) {
    // The surface owns which drawer is open (Resolve and Simulate are opened from elsewhere); without one this dock keeps its own.
    const [local, setLocal] = useState<string | null>(null);
    const owner: Partial<Pick<SurfaceModel, 'panel' | 'openPanel'>> = surface;
    const openId = owner.openPanel ? owner.panel ?? null : local;
    const setOpenId = owner.openPanel ?? setLocal;
    const available = panels.filter((p) => p.available(graph, env));
    const open = available.find((p) => p.id === openId) ?? null;
    if (available.length === 0) return null;
    const Body = open?.component;
    return (
        <>
            <div role="group" aria-label={labels.surface.panelsLabel} style={{ display: 'flex', gap: 4 }}>
                {available.map((p) => (
                    <button key={p.id} type="button" aria-pressed={p.id === openId} style={chip(p.id === openId)} onClick={() => setOpenId(p.id === openId ? null : p.id)}>
                        {labels[p.labelKey]}
                    </button>
                ))}
            </div>
            <Panel render={renderPanel} open={!!open} compact={env.compact} closeLabel={labels.close} title={open ? labels[open.labelKey] : ''} onClose={() => setOpenId(null)}>
                {Body && <Body graph={graph} source={source} rootId={rootId} rootTitle={rootTitle} onChanged={onChanged} diagnosticsText={diagnosticsText} onCamera={onCamera} cameras={cameras} labels={labels} surface={surface} onShow={onShow} onCompose={onCompose} onClose={() => setOpenId(null)} />}
            </Panel>
        </>
    );
}
