/** Zoom in / out / fit buttons over a pan-zoom surface — the keyboard and one-hand path to what wheel and pinch do. */

import type { CSSProperties } from 'react';
import type { KnowledgeGraphLabels } from './labels';
import type { PanZoom } from './usePanZoom';
import { cssVar } from './scene/themeColors';
import { button, TAP } from './styles';

const cell: CSSProperties = { ...button, padding: 0, width: TAP, fontSize: 16, borderRadius: 8, background: cssVar('panel') };

export function ZoomControls({ pan, labels }: { pan: Pick<PanZoom, 'zoomBy' | 'reset'>; labels: KnowledgeGraphLabels }) {
    return (
        <div role="group" aria-label={labels.zoomLabel} style={{ position: 'absolute', insetBlockEnd: 8, insetInlineEnd: 8, display: 'flex', gap: 4 }}>
            <button type="button" style={cell} aria-label={labels.zoomOut} title={labels.zoomOut} onClick={() => pan.zoomBy(1 / 1.4)}>−</button>
            <button type="button" style={cell} aria-label={labels.zoomIn} title={labels.zoomIn} onClick={() => pan.zoomBy(1.4)}>+</button>
            <button type="button" style={{ ...cell, width: 'auto', padding: '0 12px', fontSize: 12 }} onClick={pan.reset}>{labels.zoomReset}</button>
        </div>
    );
}
