/**
 * The depth control (PRD 43 B2): the ONE way to tilt a camera into depth — never a gesture, so tilt cannot collide with
 * pinch or page scroll. 0 is the flat home view; 1 is the placement's full tilt, where Map's stations stand as towers
 * (B1a rule 7: tilt = extrude). A native range input: keyboard, touch and screen readers work with no extra code. The
 * label comes from `KnowledgeGraphLabels` (`surface.scene.depth`), localized by the host.
 *
 * Anchored to the VIEWPORT like the zoom controls: on a tall `document` frame (Map at 360 px) the page scrolls past the
 * stage, so the control rides a zero-height sticky row at the stage's bottom edge — it stays at the bottom of whatever
 * part of the stage is on screen.
 */

import { useId, type CSSProperties } from 'react';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';

export interface DepthControlProps {
    label: string;
    value: number;
    /** The stage box's height: the sticky row sits at its bottom edge. */
    boxHeight: number;
    onChange(depth: number): void;
}

const STEPS = 100;
const BOX: CSSProperties = {
    position: 'absolute', right: 8, bottom: 8, display: 'flex', alignItems: 'center', gap: 6, minHeight: 40,
    padding: '0 8px', borderRadius: 6, background: cssVar('panel'), border: `1px solid ${cssVar('border')}`, ...TYPE.caption,
};

export function DepthControl({ label, value, boxHeight, onChange }: DepthControlProps) {
    const id = useId();
    return (
        <div style={{ position: 'sticky', bottom: 0, height: 0, marginTop: boxHeight, zIndex: 1 }} data-stage-depth-row>
            <div style={BOX} data-stage-depth>
                <label htmlFor={id}>{label}</label>
                <input
                    id={id} type="range" min={0} max={STEPS} step={1} value={Math.round(value * STEPS)}
                    style={{ width: 96, accentColor: cssVar('accent') }}
                    onChange={(e) => onChange(Number(e.currentTarget.value) / STEPS)}
                />
            </div>
        </div>
    );
}
