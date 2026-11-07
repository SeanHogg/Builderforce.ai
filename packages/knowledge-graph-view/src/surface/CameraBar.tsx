/**
 * The camera bar: the segmented *View* group (the cameras from the registry, minus those marked
 * `switcher: false` such as Sequence, which the path strip owns) and, at the far end, "↑ Out to …"
 * (while a station is open), + , − and Fit. The zoom buttons call the api the ACTIVE camera
 * registered (`zoom.tsx`); with none registered (the 3D tower) they are disabled.
 */

import type { CSSProperties } from 'react';
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
}

const zoomButton: CSSProperties = {
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

export function CameraBar({ labels, cameras, mode, onMode, outTo, onOut, zoom }: CameraBarProps) {
    // One line, never wrapped: the scene sits below a MEASURED controls block (`SceneOverlay`), so a bar that wrapped
    // would only grow it. The View group is what scrolls sideways when the row is too narrow.
    return (
        <div style={{ display: 'grid', gap: 6, padding: '8px 12px', pointerEvents: 'none' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <div style={{ minWidth: 0, maxWidth: '100%', pointerEvents: 'auto', overflowX: 'auto' }}>
                    <Segmented
                        label={labels.viewModesLabel}
                        value={mode}
                        items={cameras.filter((c) => c.switcher !== false).map((c) => ({ id: c.id, label: labels[c.labelKey] }))}
                        onChange={(id) => onMode(id as ViewMode)}
                    />
                </div>
                {/* The Sequence camera has no button in the View group (the path strip's Enlarge opens it): this is its way back. */}
                {mode === 'sequence' && <button type="button" data-back-to-map style={zoomButton} onClick={() => onMode('transit')}>{labels.surface.sequence.backToMap}</button>}
                <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flex: 'none' }}>
                    {outTo && onOut && (
                        <button type="button" data-out style={zoomButton} onClick={onOut}>{fillTemplate(labels.surface.overlay.outTo, { name: outTo })}</button>
                    )}
                    <ZoomButtons labels={labels} zoom={zoom} />
                </div>
            </div>
        </div>
    );
}
