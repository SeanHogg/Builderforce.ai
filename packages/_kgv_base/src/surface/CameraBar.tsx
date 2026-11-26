/**
 * The camera segments of the toolbar (design prototype `#tools`): the *View* segment (the cameras from the registry, minus any marked `switcher: false`;
 * icon-only, the active one shows its label) and the *3D | Flat* pair (both labelled), one `.seg` each. They are fragments of ONE wrapping row
 * (`SceneOverlay`), so on a narrow container the segments wrap instead of overflowing. "Out to" lives in the header, zoom and Fit on the stage nav.
 */

import type { CSSProperties } from 'react';
import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { CONTROL } from '../styles';
import type { ViewMode } from '../types';
import type { CameraDef } from './registry';
import { Seg } from './ui';
import { cameraGlyph } from './ui/glyphs';
import { TYPE } from './ui/type';

export interface CameraBarProps {
    labels: KnowledgeGraphLabels;
    cameras: readonly CameraDef[];
    mode: ViewMode;
    onMode(mode: ViewMode): void;
    /** The ONE 3D / Flat switch (PRD 43 C4): `flat` is its state; absent `onFlat` ⇒ no pair. */
    flat?: boolean | undefined;
    onFlat?: ((flat: boolean) => void) | undefined;
}

export const zoomButton: CSSProperties = {
    height: CONTROL, minWidth: CONTROL, padding: '0 10px', borderRadius: 8, cursor: 'pointer', font: 'inherit', ...TYPE.pill,
    border: `1px solid ${cssVar('border')}`, background: cssVar('panel'), color: cssVar('text'), pointerEvents: 'auto',
};

/** A square icon button: the glyph is decorative, the accessible name and the tooltip are the same localized label. */
export const iconButtonStyle: CSSProperties = {
    ...zoomButton, width: CONTROL, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

export function CameraBar({ labels, cameras, mode, onMode, flat = false, onFlat }: CameraBarProps) {
    // The switch drives the stage: a camera that names a placement is drawn on it, the List (a DOM component) is not.
    const drawsOnStage = !!cameras.find((c) => c.id === mode)?.placement;
    const sc = labels.surface.scene;
    return (
        <>
            <Seg
                label={labels.viewModesLabel} value={mode} onPick={(id) => onMode(id as ViewMode)}
                items={cameras.filter((c) => c.switcher !== false).map((c) => ({ id: c.id, label: labels[c.labelKey], glyph: cameraGlyph(c.id) }))}
            />
            {onFlat && drawsOnStage && (
                <Seg
                    label={sc.flatToggle} value={flat ? 'flat' : '3d'} onPick={(id) => onFlat(id === 'flat')}
                    items={[
                        { id: '3d', label: sc.view3d, glyph: cameraGlyph('depth3d'), labelled: true, testId: 'kg-dim-3d' },
                        { id: 'flat', label: sc.viewFlat, glyph: cameraGlyph('flat'), labelled: true, testId: 'kg-dim-flat' },
                    ]}
                />
            )}
        </>
    );
}
