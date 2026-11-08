/*
 * No `'use client'` — mounted only inside the model surface, which is itself reached
 * through a `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { ownedEntityIds, type Model3dState } from '@/lib/creation/model3d/model3dState';
import { Model3dEntityMesh } from './Model3dEntityMesh';
import styles from './model3dEditor.module.css';

export interface Model3dViewportColors {
  background: string;
  grid: string;
  gridSection: string;
  envelope: string;
  accent: string;
}

export interface Model3dViewportProps {
  state: Model3dState;
  selection: ReadonlySet<string>;
  colors: Model3dViewportColors;
  label: string;
  /** Absent in a read-only view: parts are not selectable, the camera still orbits. */
  onSelect?: (id: string, additive: boolean) => void;
  onClearSelection?: () => void;
}

/**
 * Draws a frame when what the scene shows changes. The canvas renders on demand (an idle
 * model costs no GPU), so a change that does not come through React's own props — here, a
 * colour read from the theme or a selection — asks for its frame explicitly.
 */
function InvalidateOn({ state, selection, colors }: { state: Model3dState; selection: ReadonlySet<string>; colors: Model3dViewportColors }) {
  const invalidate = useThree((three) => three.invalidate);
  useEffect(() => { invalidate(); }, [invalidate, state, selection, colors]);
  return null;
}

/**
 * The 3D view: an orbit camera around the build volume, a floor grid, the working
 * envelope as a wireframe, and the model.
 *
 * The model lives in Z-up space (what STL and STEP assume); the one rotation below turns
 * that into three.js's Y-up space, so no part carries two coordinate systems. Touch is
 * the orbit controls' own: one finger orbits, two pan and pinch. Every colour is passed
 * in, read from the theme by the container — nothing here is a literal.
 */
export function Model3dViewport({ state, selection, colors, label, onSelect, onClearSelection }: Model3dViewportProps) {
  const { x: bedX, y: bedY, z: bedZ } = state.buildVolumeMm;
  const reach = Math.max(bedX, bedY, bedZ);
  // The camera frames the bed once per mount; later edits must not yank the user's view.
  const target = useMemo<[number, number, number]>(() => [bedX / 2, bedZ / 2, -bedY / 2], [bedX, bedY, bedZ]);
  const start = useMemo<[number, number, number]>(() => [target[0] + reach * 1.1, target[1] + reach * 0.9, target[2] + reach * 1.1], [target, reach]);
  const roots = useMemo(() => { const owned = ownedEntityIds(state); return state.entities.filter((entity) => !owned.has(entity.id)); }, [state]);

  return <div className={styles.viewport} role="img" aria-label={label}>
    <Canvas frameloop="demand" camera={{ position: start, fov: 45, near: 1, far: reach * 20 }} dpr={[1, 2]} {...(onClearSelection ? { onPointerMissed: onClearSelection } : {})}>
      <InvalidateOn state={state} selection={selection} colors={colors} />
      <color attach="background" args={[colors.background]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[reach, reach * 2, reach]} intensity={0.9} />
      <Grid
        position={[target[0], 0, target[2]]}
        args={[bedX, bedY]}
        cellSize={10}
        sectionSize={100}
        cellColor={colors.grid}
        sectionColor={colors.gridSection}
        cellThickness={0.5}
        sectionThickness={1}
        fadeDistance={reach * 4}
        infiniteGrid={false}
      />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh position={[bedX / 2, bedY / 2, bedZ / 2]}>
          <boxGeometry args={[bedX, bedY, bedZ]} />
          <meshBasicMaterial color={colors.envelope} wireframe transparent opacity={0.35} />
        </mesh>
        {roots.map((entity) => <Model3dEntityMesh key={entity.id} entity={entity} state={state} selection={selection} accent={colors.accent} {...(onSelect ? { onSelect } : {})} />)}
      </group>
      <OrbitControls target={target} enableDamping dampingFactor={0.08} makeDefault />
    </Canvas>
  </div>;
}
