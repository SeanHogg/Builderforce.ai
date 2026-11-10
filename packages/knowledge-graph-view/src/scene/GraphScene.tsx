/**
 * The 3D scene (PRD 38 §3.2): partitions are planes, nodes ONE instanced mesh sized by
 * importance, edges ONE `LineSegments` buffer per kind (rule-breaking and cyclic edges in
 * their own warning buffers). OrbitControls work by mouse and touch (one finger orbits,
 * two pinch and pan); selecting a node flies the camera to it.
 *
 * This module is the lazy chunk — `KnowledgeGraphView` imports it with `React.lazy`, so
 * three.js costs nothing until WebGL is known to be available. The layout is computed on
 * idle, never during render. Colours are the theme's tokens, re-read on a theme flip.
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { DoubleSide, Vector3 } from 'three';
import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import type { LensDef } from '../lenses';
import { EMPTY_LAYOUT_3D, type Layout3D } from './layout3d';
import { useComputed } from '../compute/useComputed';
import { DEFER_EDGES_ABOVE } from './edgeBudget';
import { nodeInstances, type EdgeBuffer } from './buffers';
import { towerBodies, type SceneChannels } from './channels';
import { Pipes, Towers } from './Towers';
import { shapeBuckets, selOf, Cylinders, type Item } from './shapeMeshes';
import { applyRoles, type TowerRole } from './highlightRoles';
import { cssVar, useThemeColors, type ThemeColors } from './themeColors';

export interface GraphSceneProps {
    rootId: string;
    nodes: readonly KNode[];
    edges: readonly KEdge[];
    lens: LensDef;
    selected: string | null;
    focus: readonly string[];
    onSelect(ref: string): void;
    /** Plane captions: a partition name, or the host's word for "none". */
    planeLabel(partition: string): string;
    label: string;
    /** Jump the camera to the target instead of flying (reduced motion). */
    reducedMotion?: boolean;
    /** The overlay channels (height, fill band, shell, pipe width). Absent ⇒ the plain spheres and lines. */
    channels?: SceneChannels | undefined;
    /** An anti-pattern highlight: offenders and partners are lit, every other tower is dimmed. */
    roles?: ReadonlyMap<string, TowerRole> | undefined;
}

type OrbitHandle = { target: Vector3; update(): void };

function Nodes({ layout, nodes, lens, colors, selected, onSelect }: {
    layout: Layout3D; nodes: readonly KNode[]; lens: LensDef; colors: ThemeColors; selected: string | null; onSelect(ref: string): void;
}) {
    const inst = useMemo(() => nodeInstances(nodes, layout, lens), [nodes, layout, lens]);
    const items = useMemo<Item[]>(() => inst.refs.map((ref, i) => ({
        pos: [inst.positions[i * 3]!, inst.positions[i * 3 + 1]!, inst.positions[i * 3 + 2]!] as const,
        scale: [inst.scales[i]!, inst.scales[i]!, inst.scales[i]!] as const,
        tone: inst.tones[i]!,
        dim: inst.dim[i]!,
        ref,
    })), [inst]);
    // One instanced mesh per shape, so a kind keeps its silhouette without a rebuild on selection.
    const buckets = useMemo(() => shapeBuckets(items, inst.shapes), [items, inst.shapes]);
    return (
        <>
            {buckets.map(([shape, b]) => (
                <Cylinders key={shape} items={b.items} colors={colors} shape={shape} pickable={b.refs} onPick={onSelect} highlight={selOf(b, selected)} />
            ))}
        </>
    );
}

/** The edge buffers arrive from the compute worker AFTER the nodes are on screen, so 15,000 segments never hold up the first paint. */
function Edges({ buffers, colors }: { buffers: readonly EdgeBuffer[]; colors: ThemeColors }) {
    return (
        <>
            {buffers.map((b) => (
                <lineSegments key={b.bucket}>
                    <bufferGeometry>
                        <bufferAttribute attach="attributes-position" args={[b.positions, 3]} />
                    </bufferGeometry>
                    <lineBasicMaterial color={colors[b.tone]} transparent opacity={b.bucket === 'violation' || b.bucket === 'cycle' ? 0.95 : 0.5} />
                </lineSegments>
            ))}
        </>
    );
}

function FlyTo({ target, controls, reducedMotion }: { target: readonly [number, number, number] | null; controls: RefObject<OrbitHandle | null>; reducedMotion: boolean }) {
    const { camera, invalidate } = useThree();
    const goal = useRef<Vector3 | null>(null);
    useEffect(() => { goal.current = target ? new Vector3(...target) : null; invalidate(); }, [target, invalidate]);
    useFrame(() => {
        const c = controls.current;
        if (!goal.current || !c) return;
        const offset = new Vector3(6, 5, 8).add(goal.current);
        if (reducedMotion) {
            c.target.copy(goal.current);
            camera.position.copy(offset);
            c.update();
            goal.current = null;
            invalidate();
            return;
        }
        c.target.lerp(goal.current, 0.12);
        camera.position.lerp(offset, 0.08);
        c.update();
        if (c.target.distanceTo(goal.current) < 0.01) goal.current = null;
        else invalidate(); // demand loop: keep drawing until the fly lands
    });
    return null;
}

/** A canvas shown again at an unchanged size gets no resize from R3F, so ask for the frame. */
function RepaintOnShow() {
    const { gl, invalidate } = useThree();
    useEffect(() => {
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([entry]) => { if (entry && entry.contentRect.width > 0) invalidate(); });
        ro.observe(gl.domElement);
        return () => ro.disconnect();
    }, [gl, invalidate]);
    return null;
}

export default function GraphScene({ rootId, nodes, edges, lens, selected, focus, onSelect, planeLabel, label, reducedMotion = false, channels, roles }: GraphSceneProps) {
    const [host, setHost] = useState<HTMLDivElement | null>(null);
    const colors = useThemeColors(host);
    const layout = useComputed('layout3d', { rootId, nodes, edges }, [rootId, nodes, edges], null, { failed: EMPTY_LAYOUT_3D }).value;
    // At most MAX_DRAWN_EDGES links are drawn (the camera says so); the ranking is per graph, the pick per selection.
    // Ranking 100k+ edges is not render-path work: the compute worker ranks (once, and keeps it), picks for the selection and
    // builds the line buffers; it does not at all while pipes (which have their own cap) replace the lines.
    const pipes = !!channels?.pipeWidth;
    const drawnEdges = useComputed(
        'edgeBuffers', { nodes, edges, layout: layout ?? EMPTY_LAYOUT_3D, selected }, [nodes, edges, layout, selected], null,
        { enabled: !pipes && layout !== null, inline: edges.length <= DEFER_EDGES_ABOVE },
    ).value;
    const bodies = useMemo(() => (channels && layout ? applyRoles(towerBodies(nodeInstances(nodes, layout, lens), channels.nodes), roles) : null), [channels, layout, nodes, lens, roles]);
    const controls = useRef<OrbitHandle | null>(null);
    const target = useMemo(() => {
        const ref = selected ?? focus[0];
        return (ref && layout?.positions.get(ref)) || null;
    }, [selected, focus, layout]);
    const span = Math.max(12, Math.sqrt(nodes.length) * 3);
    // Canvas frameloop is 'demand': frames are drawn only on change (orbit, damping, fly invalidate), so an idle or hidden graph costs none.

    return (
        <div ref={setHost} role="img" aria-label={label} style={{ position: 'absolute', inset: 0, color: cssVar('text'), touchAction: 'none' }}>
            {colors && layout && (
                <Canvas frameloop="demand" camera={{ position: [span, span * 0.7, span], fov: 50 }} dpr={[1, 2]} style={{ background: colors.bg }}>
                    <ambientLight intensity={0.75} />
                    <directionalLight position={[10, 20, 10]} intensity={0.8} />
                    {layout.planes.map((p) => (
                        <group key={p.partition} position={[0, p.y - 0.6, 0]}>
                            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                                <planeGeometry args={[span * 1.6, span * 1.6]} />
                                <meshBasicMaterial color={colors.plane} transparent opacity={0.18} side={DoubleSide} depthWrite={false} />
                            </mesh>
                            <Html position={[-span * 0.8, 0, -span * 0.8]} style={{ pointerEvents: 'none', color: colors.muted, fontSize: 11, whiteSpace: 'nowrap' }}>
                                {planeLabel(p.partition)}
                            </Html>
                        </group>
                    ))}
                    {channels && bodies ? (
                        <>
                            <Towers bodies={bodies} colors={colors} selected={selected} onSelect={onSelect} />
                            {channels.pipeWidth ? <Pipes edges={edges} bodies={bodies} channels={channels} colors={colors} /> : drawnEdges && <Edges buffers={drawnEdges} colors={colors} />}
                        </>
                    ) : (
                        <>
                            {drawnEdges && <Edges buffers={drawnEdges} colors={colors} />}
                            <Nodes layout={layout} nodes={nodes} lens={lens} colors={colors} selected={selected} onSelect={onSelect} />
                        </>
                    )}
                    <OrbitControls ref={controls as never} makeDefault enableDamping />
                    <FlyTo target={target} controls={controls} reducedMotion={reducedMotion} />
                    <RepaintOnShow />
                </Canvas>
            )}
        </div>
    );
}
