/**
 * The Tower's channel geometry (lazy with the scene): towers sized by the size channel, a fill
 * band per tower for the ring channel, a wireframe shell for an untested file and a pipe per
 * edge whose radius is the width channel. Each kind is ONE instanced mesh, so a graph of a
 * thousand nodes stays a handful of draw calls. Selecting a node rewrites only the two
 * instances that change (the one that lost the highlight and the one that gained it).
 */

import { useMemo } from 'react';
import { Quaternion, Vector3 } from 'three';
import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import type { Body, Pipe, SceneChannels } from './channels';
import { pipes } from './channels';
import type { ThemeColors } from './themeColors';
import { Cylinders, Item, shapeBuckets, selOf, UP } from './shapeMeshes';

export function Towers({ bodies, colors, selected, onSelect }: { bodies: readonly Body[]; colors: ThemeColors; selected: string | null; onSelect(ref: string): void }) {
    // Not a function of the selection: picking a node never rebuilds these.
    const parts = useMemo(() => {
        const solid = bodies.filter((b) => !b.shell), shell = bodies.filter((b) => b.shell);
        const tower = (b: Body): Item => ({ pos: [b.x, b.y, b.z], scale: [b.radius, b.height, b.radius], tone: b.tone, dim: b.dim, ref: b.ref });
        const bands = bodies.filter((b) => b.fill !== undefined && b.fill > 0).map((b): Item => {
            const h = b.height * b.fill!;
            return { pos: [b.x, b.y - b.height / 2 + h / 2, b.z], scale: [b.radius * 1.12, h, b.radius * 1.12], tone: b.fillTone!, dim: b.dim, ref: b.ref };
        });
        return { solid, shell, solidItems: solid.map(tower), shellItems: shell.map(tower), bands };
    }, [bodies]);
    const solidShapes = useMemo(() => parts.solid.map((b) => b.shape), [parts]);
    const shellShapes = useMemo(() => parts.shell.map((b) => b.shape), [parts]);
    // One instanced mesh per shape (× shell), so a kind keeps its silhouette without a rebuild on selection.
    const solidBuckets = useMemo(() => shapeBuckets(parts.solidItems, solidShapes), [parts.solidItems, solidShapes]);
    const shellBuckets = useMemo(() => shapeBuckets(parts.shellItems, shellShapes), [parts.shellItems, shellShapes]);
    return (
        <>
            {solidBuckets.map(([shape, b]) => (
                <Cylinders key={shape} items={b.items} colors={colors} shape={shape} pickable={b.refs} onPick={onSelect} highlight={selOf(b, selected)} />
            ))}
            {shellBuckets.map(([shape, b]) => (
                <Cylinders key={`${shape}-shell`} items={b.items} colors={colors} shape={shape} wireframe pickable={b.refs} onPick={onSelect} highlight={selOf(b, selected)} />
            ))}
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
