/**
 * The Tower's channel geometry (lazy with the scene): towers sized by the size channel, a fill
 * band per tower for the ring channel, a wireframe shell for an untested file and a pipe per
 * edge whose radius is the width channel. Each kind is ONE instanced mesh, so a graph of a
 * thousand nodes stays a handful of draw calls. Selecting a node rewrites only the two
 * instances that change (the one that lost the highlight and the one that gained it).
 */

import { useEffect, useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import type { Body, Pipe, SceneChannels } from './channels';
import { pipes } from './channels';
import type { ThemeColors, ThemeTone } from './themeColors';

interface Item {
    pos: readonly [number, number, number];
    scale: readonly [number, number, number];
    quat?: Quaternion;
    tone: ThemeTone;
    dim?: boolean;
}

const UP = new Vector3(0, 1, 0);
// Temporaries shared by every write: nothing is allocated per instance.
const MATRIX = new Matrix4(), POSITION = new Vector3(), SCALE = new Vector3(), COLOR = new Color(), BG = new Color(), IDENTITY = new Quaternion();
/** The radius a highlighted tower grows by. */
const HIGHLIGHT = 1.5;

function place(m: InstancedMesh, i: number, it: Item, highlighted: boolean): void {
    const grow = highlighted ? HIGHLIGHT : 1;
    POSITION.set(...it.pos);
    SCALE.set(it.scale[0] * grow, it.scale[1], it.scale[2] * grow);
    MATRIX.compose(POSITION, it.quat ?? IDENTITY, SCALE);
    m.setMatrixAt(i, MATRIX);
}

/** ONE instanced unit cylinder (radius 1, height 1) placed, scaled and coloured per item. */
function Cylinders({ items, colors, wireframe = false, opacity = 1, pickable, onPick, highlight = -1 }: {
    items: readonly Item[]; colors: ThemeColors; wireframe?: boolean; opacity?: number; pickable?: readonly string[]; onPick?: (ref: string) => void;
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
            <cylinderGeometry args={[1, 1, 1, 14]} />
            <meshStandardMaterial roughness={0.6} metalness={0.05} wireframe={wireframe} transparent={opacity < 1} opacity={opacity} />
        </instancedMesh>
    );
}

export function Towers({ bodies, colors, selected, onSelect }: { bodies: readonly Body[]; colors: ThemeColors; selected: string | null; onSelect(ref: string): void }) {
    // Not a function of the selection: picking a node never rebuilds these.
    const parts = useMemo(() => {
        const solid = bodies.filter((b) => !b.shell), shell = bodies.filter((b) => b.shell);
        const tower = (b: Body): Item => ({ pos: [b.x, b.y, b.z], scale: [b.radius, b.height, b.radius], tone: b.tone, dim: b.dim });
        const bands = bodies.filter((b) => b.fill !== undefined && b.fill > 0).map((b): Item => {
            const h = b.height * b.fill!;
            return { pos: [b.x, b.y - b.height / 2 + h / 2, b.z], scale: [b.radius * 1.12, h, b.radius * 1.12], tone: b.fillTone!, dim: b.dim };
        });
        return { solid, shell, solidItems: solid.map(tower), shellItems: shell.map(tower), bands };
    }, [bodies]);
    const solidRefs = useMemo(() => parts.solid.map((b) => b.ref), [parts]);
    const shellRefs = useMemo(() => parts.shell.map((b) => b.ref), [parts]);
    return (
        <>
            <Cylinders items={parts.solidItems} colors={colors} pickable={solidRefs} onPick={onSelect} highlight={selected ? solidRefs.indexOf(selected) : -1} />
            <Cylinders items={parts.shellItems} colors={colors} wireframe pickable={shellRefs} onPick={onSelect} highlight={selected ? shellRefs.indexOf(selected) : -1} />
            <Cylinders items={parts.bands} colors={colors} opacity={0.9} />
        </>
    );
}

export function Pipes({ edges, bodies, channels, colors }: { edges: readonly KEdge[]; bodies: readonly Body[]; channels: SceneChannels; colors: ThemeColors }) {
    const items = useMemo(() => {
        if (!channels.pipeWidth) return [];
        return pipes(edges, bodies, channels.pipeWidth).map((p: Pipe): Item => ({
            pos: p.mid, scale: [p.radius, p.length, p.radius], tone: p.tone,
            quat: new Quaternion().setFromUnitVectors(UP, new Vector3(...p.dir)),
        }));
    }, [edges, bodies, channels]);
    return <Cylinders items={items} colors={colors} opacity={0.7} />;
}
