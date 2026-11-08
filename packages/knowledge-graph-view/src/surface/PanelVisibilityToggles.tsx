/**
 * Three small icon toggles (left, bottom, right layout glyphs) that show or hide the Lines panel, the path strip and the Act panel. Presentational: the
 * state is `usePanelVisibility`'s. A button renders only when its panel exists in this layout; none available renders nothing.
 */

import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { zoomButton } from './CameraBar';
import type { PanelSlot, PanelVisibility } from './usePanelVisibility';

export interface PanelVisibilityTogglesProps {
    labels: KnowledgeGraphLabels;
    visibility: PanelVisibility;
    onToggle(id: PanelSlot): void;
    /** Which panels exist now (a toggle for a missing panel is not drawn). */
    available: PanelVisibility;
}

/** The glyph: a frame with the slot's region filled while that panel is shown. */
function Glyph({ slot, shown }: { slot: PanelSlot; shown: boolean }) {
    const rect = slot === 'left' ? { x: 2, y: 2, width: 4, height: 12 } : slot === 'right' ? { x: 10, y: 2, width: 4, height: 12 } : { x: 2, y: 10, width: 12, height: 4 };
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ display: 'block' }}>
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="none" stroke={cssVar(shown ? 'text' : 'muted')} strokeWidth="1.3" />
            {shown && <rect {...rect} fill={cssVar('text')} />}
        </svg>
    );
}

const SLOTS: readonly PanelSlot[] = ['left', 'bottom', 'right'];
const NAMES = {
    left: ['showLeft', 'hideLeft'], bottom: ['showBottom', 'hideBottom'], right: ['showRight', 'hideRight'],
} as const;

export function PanelVisibilityToggles({ labels, visibility, onToggle, available }: PanelVisibilityTogglesProps) {
    const shown = SLOTS.filter((s) => available[s]);
    if (shown.length === 0) return null;
    const t = labels.surface.panelToggles;
    return (
        <div role="group" aria-label={t.label} style={{ display: 'inline-flex', gap: 4 }}>
            {shown.map((slot) => {
                const on = visibility[slot];
                const name = t[NAMES[slot][on ? 1 : 0]];
                return (
                    <button
                        key={slot} type="button" data-panel-toggle={slot} aria-pressed={on} aria-label={name} title={name} onClick={() => onToggle(slot)}
                        style={{ ...zoomButton, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <Glyph slot={slot} shown={on} />
                    </button>
                );
            })}
        </div>
    );
}
