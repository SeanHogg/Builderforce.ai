/**
 * The shape instanced-mesh helpers shared by the Tower view (Towers.tsx) and the plain 3D
 * graph (GraphScene.tsx). Each kind is ONE instanced mesh, so a graph of a thousand nodes
 * stays a handful of draw calls; the geometries are normalised so every silhouette covers
 * about the same volume (the box was a 1.7-wide outlier; cone and octahedron are tuned to
 * comparable bounding volume). Visualizer §2: shape in all four views — the picking +
 * selection behaviour is preserved per bucket (selOf), so a kind keeps its silhouette
 * without losing click-to-focus or the grown selection ring.
 */

import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { NodeShape } from '../lenses';
import type { ThemeColors, ThemeTone } from './themeColors';

export interface Item {
    pos: readonly [number, number, number];
    scale: readonly [number, number, number];
    quat?: Quaternion;
    tone: ThemeTone;
    dim?: boolean;
    ref?: string;
}

export const UP = new Vector3(0, 1, 0);
// Temporaries shared by every write: nothing is allocated per instance.
const MATRIX = new Matrix4(), POSITION = new Vector3(), SCALE = new Vector3(), COLOR = new Color(), BG = new Color(), IDENTITY = new Quaternion();
/** The radius a highlighted tower grows by. */
const HIGHLIGHT = 1.5;

export function place(m: InstancedMesh, i: number, it: Item, highlighted: boolean): void {
    const grow = highlighted ? HIGHLIGHT : 1;
    POSITION.set(...it.pos);
    SCALE.set(it.scale[0] * grow, it.scale[1], it.scale[2] * grow);
    MATRIX.compose(POSITION, it.quat ?? IDENTITY, SCALE);
    m.setMatrixAt(i, MATRIX);
}

/** The geometry a shape instanced-mesh draws: a cylinder stays the default; the others swap the primitive. */
export function ShapeGeometry({ shape }: { shape: NodeShape }) {
    switch (shape) {
        case 'square': return <boxGeometry args={[2, 1, 2]} />;
        case 'diamond': return <octahedronGeometry args={[1, 0]} />;
        case 'triangle': return <coneGeometry args={[1, 1, 4]} />;
        case 'hexagon': return <cylinderGeometry args={[1, 1, 1, 6]} />;
        case 'octagon': return <cylinderGeometry args={[1, 1, 1, 8]} />;
        case 'pentagon': return <cylinderGeometry args={[1, 1, 1, 5]} />;
        // The star silhouette is a 5-pointed cone in 3D (its 2D counterpart is the SVG path).
        case 'star': return <cylinderGeometry args={[1, 1, 1, 10]} />;
        default: return <cylinderGeometry args={[1, 1, 1, 14]} />;
    }
}

/** ONE instanced unit primitive (radius 1, height 1) placed, scaled and coloured per item. */
export function Cylinders({ items, colors, shape, wireframe = false, opacity = 1, pickable, onPick, highlight = -1 }: {
    items: readonly Item[]; colors: ThemeColors; shape?: NodeShape; wireframe?: boolean; opacity?: number; pickable?: readonly string[]; onPick?: (ref: string) => void;
    /** Index of the instance drawn grown (the selection); -1 for none. */
    highlight?: number;
}) {
    const mesh = useRef<InstancedMesh>(null);
    const invalidate = useThree((s) => s.invalidate);
    const lit = useRef(-1);
    const highlightNow = useRef(highlight);
    highlightNow.current = highlight;

    // Everything: only when the items or the colours change.
    useEffect(() => {
        const m = mesh.current;
        if (!m) return;
        items.forEach((it, i) => {
            place(m, i, it, i === highlightNow.current);
            COLOR.set(colors[it.tone]);
            if (it.dim) COLOR.lerp(BG.set(colors.bg), 0.65);
            m.setColorAt(i, COLOR);
        });
        lit.current = highlightNow.current;
        m.count = items.length;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.computeBoundingSphere();
        invalidate();
    }, [items, colors, invalidate]);

    // A selection change: two instances.
    useEffect(() => {
        const m = mesh.current;
        if (!m || lit.current === highlight) return;
        for (const i of [lit.current, highlight]) {
            const it = items[i];
            if (it) place(m, i, it, i === highlight);
        }
        lit.current = highlight;
        m.instanceMatrix.needsUpdate = true;
        invalidate();
    }, [highlight, items, invalidate]);

    const pick = (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        const ref = e.instanceId !== undefined ? pickable?.[e.instanceId] : undefined;
        if (ref && onPick) onPick(ref);
    };
    if (items.length === 0) return null;
    return (
        <instancedMesh ref={mesh} args={[undefined, undefined, items.length]} onClick={pickable ? pick : undefined} {...(pickable ? {} : { raycast: () => null })}>
            <ShapeGeometry shape={shape ?? 'circle'} />
            <meshStandardMaterial roughness={0.6} metalness={0.05} wireframe={wireframe} transparent={opacity < 1} opacity={opacity} />
        </instancedMesh>
    );
}

/** One bucket per shape, so a kind keeps its silhouette with ONE instanced mesh per shape (× shell). */
export function shapeBuckets(items: readonly Item[], shapes: readonly NodeShape[] | undefined) {
    const map = new Map<NodeShape, { items: Item[]; refs: string[] }>();
    items.forEach((it, i) => {
        const shape = shapes?.[i] ?? 'circle';
        let b = map.get(shape);
        if (!b) { b = { items: [], refs: [] }; map.set(shape, b); }
        b.items.push(it); b.refs.push(it.ref ?? '');
    });
    return [...map.entries()];
}

/** A bucket's local index of the selection: -1 when the selected node is not in this bucket. */
export function selOf(bucket: { refs: string[] }, selected: string | null): number {
    return selected ? bucket.refs.indexOf(selected) : -1;
}
