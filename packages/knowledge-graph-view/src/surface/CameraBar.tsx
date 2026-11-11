/**
 * The camera bar: the segmented *View* group (the cameras from the registry, minus those marked
 * `switcher: false` such as Sequence, which the path strip owns) and, at the far end, "↑ Out to …"
 * (while a station is open), the panel show/hide toggles, + , − and Fit. Right after the View group sits the `tools` slot
 * (the Panels group and Risk overlays; on a phone its own scrolling line). The zoom buttons call the api the ACTIVE camera
 * registered (`zoom.tsx`); with none registered (the 3D tower) they are disabled.
 */

import type { CSSProperties, ReactNode } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { CONTROL } from '../styles';
import type { ViewMode } from '../types';
import type { CameraDef } from './registry';
import { Segmented } from './ui';
import { TYPE } from './ui/type';
import type { ZoomApi } from './zoom';

export interface CameraBarProps {
    labels: KnowledgeGraphLabels;
    cameras: readonly CameraDef[];
    mode: ViewMode;
    onMode(mode: ViewMode): void;
    /** The level above the open station ("the line"); present ⇒ the "↑ Out to …" button shows. */
    outTo?: string | null | undefined;
    onOut?: (() => void) | undefined;
    /** The active camera's zoom; null/absent ⇒ +, − and Fit are disabled. */
    zoom?: ZoomApi | null | undefined;
    /** The canvas tools (Panels, Risk overlays), right after the View group and outside its scroller so a popover is not clipped. */
    tools?: ReactNode;
    /** On a phone the tools take their own sideways-scrolling line instead of sharing the View row. */
    stacked?: boolean | undefined;
    /** The panel show/hide toggles, before the zoom buttons. */
    panelToggles?: ReactNode;
    /** The Legend button: next to the panel toggles, outside the sideways scroller so its popover is not clipped. */
    legend?: ReactNode;
}

export const zoomButton: CSSProperties = {
    height: CONTROL, minWidth: CONTROL, padding: '0 10px', borderRadius: 8, cursor: 'pointer', font: 'inherit', ...TYPE.pill,
    border: `1px solid ${cssVar('border')}`, background: cssVar('panel'), color: cssVar('text'), pointerEvents: 'auto',
};

function ZoomButtons({ labels, zoom }: { labels: KnowledgeGraphLabels; zoom: ZoomApi | null | undefined }) {
    const off = !zoom;
    const style: CSSProperties = { ...zoomButton, ...(off ? { opacity: 0.5, cursor: 'default' } : null) };
    return (
        <div role="group" aria-label={labels.zoomLabel} style={{ display: 'inline-flex', gap: 4 }}>
            <button type="button" disabled={off} aria-label={labels.zoomIn} title={labels.zoomIn} style={style} onClick={() => zoom?.zoomIn()}>+</button>
            <button type="button" disabled={off} aria-label={labels.zoomOut} title={labels.zoomOut} style={style} onClick={() => zoom?.zoomOut()}>−</button>
            <button type="button" disabled={off} aria-label={labels.zoomReset} title={labels.zoomReset} style={style} onClick={() => zoom?.fit()}>{labels.surface.overlay.fit}</button>
        </div>
    );
}

export function CameraBar({ labels, cameras, mode, onMode, outTo, onOut, zoom, tools, stacked = false, panelToggles, legend }: CameraBarProps) {
    // The row WRAPS: the right cluster (Legend, panel toggles, +, −, Fit) never shrinks or scrolls away — on a narrow
    // container it drops to a second line, end-aligned. The scene sits below the MEASURED controls block
    // (`SceneOverlay`, `--kg-scene-top`), so a wrapped bar only moves the scene down. One line that never wrapped
    // pushed the cluster off-screen at ~700px and made the whole overlay wider than the scene (a sideways scrollbar).
    // Only the View group scrolls sideways, when it alone is wider than the row.
    return (
        <div style={{ display: 'grid', gap: 6, padding: '8px 12px', pointerEvents: 'none', minWidth: 0 }}>
            <div data-testid="kg-camera-row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                <div style={{ minWidth: 0, maxWidth: '100%', flex: '0 1 auto', pointerEvents: 'auto', overflowX: 'auto' }}>
                    <Segmented
                        label={labels.viewModesLabel}
                        value={mode}
                        items={cameras.filter((c) => c.switcher !== false).map((c) => ({ id: c.id, label: labels[c.labelKey] }))}
                        onChange={(id) => onMode(id as ViewMode)}
                    />
                </div>
                {tools && !stacked && <div data-testid="kg-scene-tools" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flex: 'none', pointerEvents: 'auto' }}>{tools}</div>}
                {/* The Sequence camera has no button in the View group (the path strip's Enlarge opens it): this is its way back. */}
                {mode === 'sequence' && <button type="button" data-back-to-map style={zoomButton} onClick={() => onMode('transit')}>{labels.surface.sequence.backToMap}</button>}
                {/* The right cluster: one unit that wraps whole and is pushed to the row's end; it never scrolls or clips. */}
                <div data-testid="kg-camera-right" style={{ display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, alignItems: 'center', flex: 'none', maxWidth: '100%', marginInlineStart: 'auto', pointerEvents: 'auto' }}>
                    {legend && <div data-testid="kg-legend-slot" style={{ display: 'inline-flex', flex: 'none' }}>{legend}</div>}
                    {outTo && onOut && (
                        <button type="button" data-out title={fillTemplate(labels.surface.overlay.outTo, { name: outTo })} style={{ ...zoomButton, whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={onOut}>{fillTemplate(labels.surface.overlay.outTo, { name: outTo })}</button>
                    )}
                    {panelToggles}
                    <ZoomButtons labels={labels} zoom={zoom} />
                </div>
            </div>
            {/* A phone: the tools scroll sideways on their own line (their popover is anchored to the overlay, so the scroller does not clip it). */}
            {tools && stacked && <div data-testid="kg-scene-tools" style={{ display: 'flex', gap: 8, alignItems: 'center', overflowX: 'auto', pointerEvents: 'auto', maxWidth: '100%', padding: 3, margin: -3 }}>{tools}</div>}
        </div>
    );
}
