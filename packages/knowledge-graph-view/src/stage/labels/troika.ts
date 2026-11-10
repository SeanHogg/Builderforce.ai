/// <reference path="./troika.d.ts" />
/**
 * The troika implementation of the label pass's text port (PRD 43 B3: JetBrains Mono names in ONE `BatchedText` draw
 * call, the halo through `outlineWidth`/`outlineColor`). Imported directly — drei stays out of the stage. Kept apart
 * from `LabelLayer` so jsdom tests drive the layer through a fake port and never start troika's worker.
 */

import { Group, MeshBasicMaterial, type Object3D } from 'three';
import { BatchedText, Text } from 'troika-three-text';
import type { LabelText, TextPort } from './LabelLayer';

/** Above the planes (−1), links (1) and marks (2): names paint last, as SVG text did. */
export const LABEL_RENDER_ORDER = 3;

export function troikaTextPort(onSynced: () => void): TextPort {
    const batch = new BatchedText();
    batch.name = 'labels';
    batch.frustumCulled = false;
    // The BASE material (troika derives the fill and halo materials from it): no depth test — the line shader writes
    // its own fragment depth, so a tested label would hide under a hop's casing (seen on the GPU run) — and transparent.
    batch.material = new MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true });
    // A group's renderOrder sorts everything under it (the links' group is 1), so the batch sits in its own group.
    const group = new Group();
    group.name = 'labels';
    group.renderOrder = LABEL_RENDER_ORDER;
    group.add(batch);
    batch.addEventListener('synccomplete' as never, onSynced);
    return {
        object: group as Object3D,
        create: () => {
            const t = new Text();
            // The ground plane faces up; with the stage's camera, screen up is world −z.
            t.rotation.x = -Math.PI / 2;
            t.anchorY = 'top';
            t.sdfGlyphSize = 64;
            return t as unknown as LabelText;
        },
        add: (t) => batch.addText(t as unknown as Text),
        remove: (t) => batch.removeText(t as unknown as Text),
        dispose: () => { batch.removeEventListener('synccomplete' as never, onSynced); batch.dispose(); },
    };
}
