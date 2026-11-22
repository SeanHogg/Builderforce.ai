/**
 * The camera bar: the segmented *View* group (the cameras from the registry, minus those marked
 * `switcher: false` such as Sequence, which the path strip owns) and, at the far end, an icon for
 * "Out to …" (while a station is open). Right after the View group sits the `tools` slot
 * (the Panels and overlay icons; on a phone their own scrolling line). Zoom and Fit live only on the stage nav
 * (`stage/rig/NavControl`); the shape key is docked on the stage corner, not here.
 */

import type { CSSProperties, ReactNode } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { CONTROL } from '../styles';
import type { ViewMode } from '../types';
import type { CameraDef } from './registry';
import { Segmented } from './ui';
import { TYPE } from './ui/type';

export interface CameraBarProps {
    labels: KnowledgeGraphLabels;
    cameras: readonly CameraDef[];
    mode: ViewMode;
    onMode(mode: ViewMode): void;
    /** The level above the open station ("the line"); present ⇒ the Out icon shows. */
    outTo?: string | null | undefined;
    onOut?: (() => void) | undefined;
    /** The canvas tools (Panels, overlays), right after the View group and outside its scroller so a popover is not clipped. */
    tools?: ReactNode;
    /** On a phone the tools take their own sideways-scrolling line instead of sharing the View row. */
    stacked?: boolean | undefined;
}

export const zoomButton: CSSProperties = {
    height: CONTROL, minWidth: CONTROL, padding: '0 10px', borderRadius: 8, cursor: 'pointer', font: 'inherit', ...TYPE.pill,
    border: `1px solid ${cssVar('border')}`, background: cssVar('panel'), color: cssVar('text'), pointerEvents: 'auto',
};

/** A square icon button: the glyph is decorative, the accessible name and the tooltip are the same localized label. */
export const iconButtonStyle: CSSProperties = {
    ...zoomButton, width: CONTROL, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

function IconButton({ label, onClick, testId, children }: { label: string; onClick(): void; testId?: string; children: ReactNode }) {
    return (
        <button type="button" aria-label={label} title={label} data-testid={testId} style={iconButtonStyle} onClick={onClick}>
            {children}
        </button>
    );
}

function Glyph({ children }: { children: ReactNode }) {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ display: 'block', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            {children}
        </svg>
    );
}

/** One icon per switcher camera (ids from the registry, `cameras.tsx`); an unknown id keeps its text label. */
function cameraGlyph(id: string): ReactNode {
    switch (id) {
        // Transit: an isometric map — two offset sheets.
        case 'transit': return <Glyph><rect x="2.5" y="5.5" width="8" height="8" rx="1" /><rect x="5.5" y="2.5" width="8" height="8" rx="1" /></Glyph>;
        // System: three stacked layers.
        case 'system': return <Glyph><path d="M8 2.5 13.5 5 8 7.5 2.5 5 8 2.5z" /><path d="M2.5 8 8 10.5 13.5 8M2.5 11 8 13.5 13.5 11" /></Glyph>;
        // Graph: three connected nodes.
        case 'graph': return <Glyph><path d="M5.7 4.9l4.6 1.2M4.6 6.1l1.8 4.3M10.9 7.8l-2.7 2.9" /><circle cx="4" cy="4.5" r="1.7" /><circle cx="12" cy="6.5" r="1.7" /><circle cx="7" cy="12" r="1.7" /></Glyph>;
        // Map: a radial mind-map — center dot, three spokes.
        case 'map': return <Glyph><path d="M8 6.5V4.2M9.3 8.8l2.4 1.6M6.7 8.8l-2.4 1.6" /><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" /><circle cx="8" cy="3" r="1.2" /><circle cx="12.8" cy="11.2" r="1.2" /><circle cx="3.2" cy="11.2" r="1.2" /></Glyph>;
        // 3D: a cube.
        case '3d': return <Glyph><path d="M8 2.5 13 5v6l-5 2.5L3 11V5l5-2.5z" /><path d="M3 5l5 2.5L13 5M8 7.5v6" /></Glyph>;
        // Heat: three rising bars.
        case 'heat': return <Glyph><path d="M4 13V9.5M8 13V6M12 13V3" /></Glyph>;
        // Style: a half-filled swatch circle.
        case 'style': return <Glyph><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" /></Glyph>;
        // Features: a flag.
        case 'features': return <Glyph><path d="M4 13.5V2.5M4 3h8l-2 2.5 2 2.5H4" /></Glyph>;
        // List: three horizontal lines.
        case 'list': return <Glyph><path d="M3 4.5h10M3 8h10M3 11.5h10" /></Glyph>;
        default: return undefined;
    }
}

export function CameraBar({ labels, cameras, mode, onMode, outTo, onOut, tools, stacked = false }: CameraBarProps) {
    // The row WRAPS: the right cluster (Out) never shrinks or scrolls away — on a narrow
    // container it drops to a second line, end-aligned. The scene sits below the MEASURED controls block
    // (`SceneOverlay`, `--kg-scene-top`), so a wrapped bar only moves the scene down. One line that never wrapped
    // pushed the cluster off-screen at ~700px and made the whole overlay wider than the scene (a sideways scrollbar).
    // Only the View group scrolls sideways, when it alone is wider than the row. Zoom and Fit are the stage nav's.
    const backLabel = labels.surface.sequence.backToMap;
    const outLabel = outTo ? fillTemplate(labels.surface.overlay.outTo, { name: outTo }) : '';
    return (
        <div style={{ display: 'grid', gap: 6, padding: '8px 12px', pointerEvents: 'none', minWidth: 0 }}>
            <div data-testid="kg-camera-row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                <div style={{ minWidth: 0, maxWidth: '100%', flex: '0 1 auto', pointerEvents: 'auto', overflowX: 'auto' }}>
                    <Segmented
                        label={labels.viewModesLabel}
                        value={mode}
                        items={cameras.filter((c) => c.switcher !== false).map((c) => ({ id: c.id, label: labels[c.labelKey], glyph: cameraGlyph(c.id) }))}
                        onChange={(id) => onMode(id as ViewMode)}
                    />
                </div>
                {tools && !stacked && <div data-testid="kg-scene-tools" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flex: 'none', pointerEvents: 'auto' }}>{tools}</div>}
                {/* The Sequence camera has no button in the View group (the path strip's Enlarge opens it): this is its way back. */}
                {mode === 'sequence' && (
                    <IconButton label={backLabel} testId="kg-back-to-map" onClick={() => onMode('transit')}>
                        <span data-back-to-map style={{ display: 'contents' }} />
                        <Glyph><rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M2.5 7.5h11M6 3v10M10 3v10" /></Glyph>
                    </IconButton>
                )}
                {/* The right cluster: one unit that wraps whole and is pushed to the row's end; it never scrolls or clips. */}
                <div data-testid="kg-camera-right" style={{ display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, alignItems: 'center', flex: 'none', maxWidth: '100%', marginInlineStart: 'auto', pointerEvents: 'auto' }}>
                    {outTo && onOut && (
                        <IconButton label={outLabel} testId="kg-out" onClick={onOut}>
                            <span data-out style={{ display: 'contents' }} />
                            <Glyph><path d="M8 13V3.5M4.5 7 8 3.5 11.5 7" /></Glyph>
                        </IconButton>
                    )}
                </div>
            </div>
            {/* A phone: the tools scroll sideways on their own line (their popover is anchored to the overlay, so the scroller does not clip it). */}
            {tools && stacked && <div data-testid="kg-scene-tools" style={{ display: 'flex', gap: 8, alignItems: 'center', overflowX: 'auto', pointerEvents: 'auto', maxWidth: '100%', padding: 3, margin: -3 }}>{tools}</div>}
        </div>
    );
}
