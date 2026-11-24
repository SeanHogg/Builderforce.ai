/**
 * The tools of the canvas bar: the Panels group (Coverage, Patterns, API...), the Risk overlays menu and the Simulate toggle. They sit right after the View group
 * in `CameraBar` (its `tools` slot), because they change what the canvas shows. It composes two existing controls and owns no state: the open panel and the
 * overlay bindings are the surface's, passed down.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';
import { OverlayMenu } from './OverlayMenu';
import { PanelToggle } from './PanelDock';
import type { PanelId } from './panels';
import type { SurfaceEnv } from './registry';
import type { SurfaceModel } from './useSurface';
import { Pill } from './ui';

export interface SceneToolsProps {
    graph: KnowledgeGraph;
    env: SurfaceEnv;
    labels: KnowledgeGraphLabels;
    surface: SurfaceModel;
    /** The open drawer's id; null = none. */
    panel: string | null;
    onPanel(id: PanelId | null): void;
    /** The Panels group is one "Panels ▾" menu (`layoutOf(width).panelsMenu`). */
    panelsMenu: boolean;
    /** A phone: the Panels group stays a row of buttons (the row scrolls) and the overlay menu spans the width. */
    narrow: boolean;
    /** The Simulate mode toggle; absent = not offered. */
    simulate?: { pressed: boolean; ariaLabel: string; onToggle(): void };
}

export function SceneTools({ graph, env, labels, surface, panel, onPanel, panelsMenu, narrow, simulate }: SceneToolsProps) {
    return (
        <>
            <PanelToggle graph={graph} env={env} labels={labels} panel={panel} onPanel={onPanel} collapsed={panelsMenu && !narrow} />
            <OverlayMenu
                labels={labels} stations={surface.stations.stations} bindings={surface.overlay.bindings} preset={surface.preset} coverage={surface.coverage}
                onPreset={surface.setPreset} onChannel={surface.setChannel} onPins={surface.setPins} narrow={narrow}
            />
            {simulate && (
                <Pill data-simulate-toggle on={simulate.pressed} aria-label={simulate.ariaLabel} onClick={simulate.onToggle} style={{ minHeight: 28 }}>
                    {labels.surface.simulate.modeOpen}
                </Pill>
            )}
        </>
    );
}
