/**
 * The registry's availability rule and the left dock's edge. The panels themselves are the drawer's tabs (`Drawer.tsx`); the Lines list on the left is the
 * one side dock left, and `DockEdge` is its collapse control.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { PANELS } from './panels';
import type { PanelDef, SurfaceEnv } from './registry';
import type { PanelSlot } from './usePanelVisibility';

/** The panels of the registry that are available for this graph. */
export const availablePanels = (graph: KnowledgeGraph, env: SurfaceEnv, panels: readonly PanelDef[] = PANELS): PanelDef[] =>
    panels.filter((p) => p.available(graph, env));

/** A collapsed dock keeps this much of itself: a thin rail the edge chevron sits on. */
export const DOCK_RAIL = 28;

const TOGGLE_NAMES = { left: ['showLeft', 'hideLeft'] } as const;

/** Points toward the edge the dock collapses to, and back into the scene when it is a rail. */
function chevronGlyph(shown: boolean, below: boolean): string {
    if (below) return shown ? '▾' : '▴';
    return shown ? '‹' : '›';
}

export interface DockEdgeProps {
    slot: PanelSlot;
    /** Open (the panel) or collapsed (the rail). The same flag `usePanelVisibility` stores. */
    shown: boolean;
    onToggle(id: PanelSlot): void;
    labels: KnowledgeGraphLabels;
    /** The dock sits under the scene (the stacked lines list): the rail is a strip, the chevron on its top edge. */
    below?: boolean;
    children: ReactNode;
}

/**
 * The edge of the left dock (the Lines list). The chevron on the edge toward the scene
 * collapses the dock to a thin rail and re-expands it. Names come from `labels.surface.panelToggles`.
 */
export function DockEdge({ slot, shown, onToggle, labels, below = false, children }: DockEdgeProps) {
    const t = labels.surface.panelToggles;
    const name = t[TOGGLE_NAMES[slot][shown ? 1 : 0]];
    const horizontal = below;
    const rail: CSSProperties = horizontal
        ? { height: DOCK_RAIL, width: '100%', borderTop: `1px solid ${cssVar('border')}` }
        : {
            width: DOCK_RAIL, alignSelf: 'stretch',
            borderInlineEnd: `1px solid ${cssVar('border')}`,
        };
    // Inset on the inner edge so a parent that clips overflow, or the scene beside it, cannot cover the control.
    const place: CSSProperties = !shown
        ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
        : horizontal
            ? { top: 4, left: '50%', transform: 'translateX(-50%)' }
            : { top: '50%', right: 4, transform: 'translateY(-50%)' };
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
                <span aria-hidden="true">{chevronGlyph(shown, below)}</span>
            </button>
            {shown ? children : null}
        </div>
    );
}
