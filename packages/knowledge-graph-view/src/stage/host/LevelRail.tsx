/**
 * The level rail (the design's `#zoom`), top-right of the stage in every camera: a vertical rail of the semantic-zoom
 * levels (system, class, method, code) with an accent thumb on the current one — past levels normal, the current bold,
 * deeper ones faint — and under it a small hint chip about what the zoom does next. A click goes to that level. The chip
 * hides in a narrow stage (≤ 900px), the rail stays.
 */

import type { CSSProperties } from 'react';
import { fillTemplate } from '../../labels';
import type { SceneLabels } from '../../labels/surface.scene';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';
import type { ZoomBand } from '../labels/lod';

const ROW_PX = 24;
const chip: CSSProperties = { maxWidth: 210, padding: '2px 8px', border: `1px solid ${cssVar('border')}`, borderRadius: 4, background: cssVar('panel'), ...TYPE.meta, textAlign: 'right' };

export interface LevelRailProps {
    zoom: SceneLabels['zoom'];
    /** The levels on the rail, outermost first. */
    bands: readonly ZoomBand[];
    /** The index of the level on show. */
    current: number;
    onGo(index: number): void;
    /** The station the zoom would go inside next (the pick), else null. */
    into: string | null;
    /** Nothing deeper can be entered from here. */
    deepest: boolean;
    narrow: boolean;
}

export function LevelRail({ zoom, bands, current, onGo, into, deepest, narrow }: LevelRailProps) {
    const hint = deepest ? zoom.hintDeepest : into ? fillTemplate(zoom.hintInto, { name: into }) : zoom.hintIn;
    return (
        <div data-level-rail style={{ position: 'absolute', zIndex: 2, insetInlineEnd: 10, insetBlockStart: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, pointerEvents: 'none' }}>
            <div role="group" aria-label={zoom.group} style={{ position: 'relative', display: 'flex', flexDirection: 'column', paddingInlineStart: 12, border: `1px solid ${cssVar('border')}`, borderRadius: 4, background: cssVar('panel'), pointerEvents: 'auto' }}>
                <span aria-hidden="true" style={{ position: 'absolute', insetInlineStart: 7, top: 12, bottom: 12, width: 1, background: cssVar('border') }} />
                {bands.map((b, i) => (
                    <button
                        key={b} type="button" data-level={b} aria-pressed={i === current} onClick={() => onGo(i)}
                        style={{ height: ROW_PX, border: 0, background: 'none', padding: '0 8px 0 6px', cursor: 'pointer', textAlign: 'left', font: 'inherit', fontSize: 11.5, color: cssVar(i > current ? 'muted' : 'text'), opacity: i > current ? 0.6 : 1, fontWeight: i === current ? 600 : 400 }}
                    >
                        {zoom[b]}
                    </button>
                ))}
                <i aria-hidden="true" data-level-thumb style={{ position: 'absolute', insetInlineStart: 4, top: current * ROW_PX + (ROW_PX - 7) / 2, width: 7, height: 7, borderRadius: '50%', background: cssVar('accent') }} />
            </div>
            {!narrow && <div role="status" aria-live="polite" data-level-hint style={chip}>{hint}</div>}
        </div>
    );
}
