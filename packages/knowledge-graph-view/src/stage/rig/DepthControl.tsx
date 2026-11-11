/**
 * The depth control (PRD 43 B2): the ONE way to tilt a camera into depth — never a gesture, so tilt cannot collide with
 * pinch or page scroll. 0 is the flat home view; 1 is the placement's full tilt, where Map's stations stand as towers
 * (B1a rule 7: tilt = extrude). A native range input: keyboard, touch and screen readers work with no extra code. The
 * label comes from `KnowledgeGraphLabels` (`surface.scene.depth`), localized by the host.
 *
 * It sits in the stage's corner (`StageCorner`), under the nav control.
 */

import { useId, type CSSProperties } from 'react';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';

export interface DepthControlProps {
    label: string;
    value: number;
    onChange(depth: number): void;
}

const STEPS = 100;
const BOX: CSSProperties = {
    display: 'flex', pointerEvents: 'auto', alignItems: 'center', gap: 6, minHeight: 40,
    padding: '0 8px', borderRadius: 6, background: cssVar('panel'), border: `1px solid ${cssVar('border')}`, ...TYPE.caption,
};

export function DepthControl({ label, value, onChange }: DepthControlProps) {
    const id = useId();
    return (
        <div style={BOX} data-stage-depth>
            <label htmlFor={id}>{label}</label>
            <input
                id={id} type="range" min={0} max={STEPS} step={1} value={Math.round(value * STEPS)}
                style={{ width: 96, accentColor: cssVar('accent') }}
                onChange={(e) => onChange(Number(e.currentTarget.value) / STEPS)}
            />
        </div>
    );
}
