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
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { Color, DoubleSide, InstancedMesh, Matrix4, Vector3 } from 'three';
import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import type { LensDef } from '../lenses';
import { layout3d, type Layout3D } from './layout3d';
import { useIdleValue } from '../useIdleValue';
import { edgeBuffers, nodeInstances } from './buffers';
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
}

type OrbitHandle = { target: Vector3; update(): void };

function Nodes({ layout, nodes, lens, colors, selected, onSelect }: {
    layout: Layout3D; nodes: readonly KNode[]; lens: LensDef; colors: ThemeColors; selected: string | null; onSelect(ref: string): void;
}) {
    const mesh = useRef<InstancedMesh>(null);
    const invalidate = useThree((s) => s.invalidate);
    const inst = useMemo(() => nodeInstances(nodes, layout, lens), [nodes, layout, lens]);
    useEffect(() => {
        const m = mesh.current;
        if (!m) return;
        const matrix = new Matrix4();
        const color = new Color();
        for (let i = 0; i < inst.refs.length; i++) {
            const s = inst.scales[i]! * (inst.refs[i] === selected ? 1.6 : 1);
            matrix.makeScale(s, s, s).setPosition(inst.positions[i * 3]!, inst.positions[i * 3 + 1]!, inst.positions[i * 3 + 2]!);
            m.setMatrixAt(i, matrix);
            color.set(colors[inst.tones[i]!]);
            if (inst.dim[i]) color.lerp(new Color(colors.bg), 0.65);
            m.setColorAt(i, color);
        }
        m.count = inst.refs.length;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.computeBoundingSphere();
        invalidate(); // matrices/colours are written straight to the mesh, which the reconciler never sees
    }, [inst, colors, selected, invalidate]);
    const pick = (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        const ref = e.instanceId !== undefined ? inst.refs[e.instanceId] : undefined;
        if (ref) onSelect(ref);
    };
    return (
        <instancedMesh ref={mesh} args={[undefined, undefined, Math.max(1, inst.refs.length)]} onClick={pick}>
            <sphereGeometry args={[1, 14, 10]} />
            <meshStandardMaterial roughness={0.6} metalness={0.05} />
        </instancedMesh>
    );
}

function Edges({ layout, edges, colors }: { layout: Layout3D; edges: readonly KEdge[]; colors: ThemeColors }) {
    const buffers = useMemo(() => edgeBuffers(edges, layout), [edges, layout]);
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

export default function GraphScene({ rootId, nodes, edges, lens, selected, focus, onSelect, planeLabel, label, reducedMotion = false }: GraphSceneProps) {
    const [host, setHost] = useState<HTMLDivElement | null>(null);
    const colors = useThemeColors(host);
    const layout = useIdleValue(() => layout3d(rootId, nodes, edges), [rootId, nodes, edges]);
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
                    <Edges layout={layout} edges={edges} colors={colors} />
                    <Nodes layout={layout} nodes={nodes} lens={lens} colors={colors} selected={selected} onSelect={onSelect} />
                    <OrbitControls ref={controls as never} makeDefault enableDamping />
                    <FlyTo target={target} controls={controls} reducedMotion={reducedMotion} />
                    <RepaintOnShow />
                </Canvas>
            )}
        </div>
    );
}
