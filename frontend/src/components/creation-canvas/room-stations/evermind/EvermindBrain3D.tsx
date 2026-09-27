/*
 * No `'use client'` — mounted only inside the room, which is reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useMemo, useRef, type CSSProperties } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { DoubleSide, SphereGeometry, type Group, type MeshStandardMaterial } from 'three';
import {
  EVERMIND_REGION_KEYS,
  REGION_HUE_VAR,
  type EvermindRegionKey,
  type EvermindRegionSignal,
} from '@/lib/evermindRegions';
import {
  BRAIN_CENTRES,
  BRAINSTEM,
  CEREBELLUM,
  HEMISPHERE,
  MAX_MEMORY_DOTS,
  PATHWAY_HUB,
  cortexMemorySpot,
  gyrusRipple,
  hippocampalMemorySpot,
} from './evermindBrainAnatomy';
import { useTheme } from '@/lib/useTheme';
import styles from './evermindBrain.module.css';

/**
 * THE EVERMIND, AS A BRAIN STANDING IN THE ROOM.
 *
 * A translucent, folded cortex with the learning centres inside it, each lit by its
 * real signal (`evermindRegionSignals` — the same derivation the Studio's 2D map
 * reads): the neocortex shell glows with fitted weights and carries one bright point
 * per fitted learning; taught memories orbit the hippocampi; the limbic centres burn
 * with the live affective state; every centre is wired to the thalamus, the relay.
 *
 * Presentational: it is handed the signals and the centres' names; the station's hook
 * owns the data. Colours are the theme's own region tokens (`--ev-*` in globals.css),
 * read from the document, because WebGL cannot resolve a CSS variable, and read again
 * whenever the theme flips. The names float as DOM
 * (legible at any distance, in either theme) and are hidden from assistive tech — the
 * station's panel is the accessible reading of the same centres.
 */

export interface EvermindBrain3DProps {
  signals: Record<EvermindRegionKey, EvermindRegionSignal>;
  /** Each centre's translated name. */
  names: Record<EvermindRegionKey, string>;
}

type Hues = Record<EvermindRegionKey | 'core' | 'tissue', string>;

/** Dark-theme region identities — only used where no document exists to read. */
const FALLBACK_HUES: Hues = {
  neocortex: '#3987e5', hippocampus: '#199e70', amygdala: '#e66767', hypothalamus: '#d95926',
  thalamus: '#c98500', basalGanglia: '#d55181', personality: '#8b5cf6', core: '#fb7185', tissue: '#94a3b8',
};

function readHues(): Hues {
  if (typeof document === 'undefined') return FALLBACK_HUES;
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const hues = { ...FALLBACK_HUES };
  for (const key of EVERMIND_REGION_KEYS) hues[key] = read(REGION_HUE_VAR[key], FALLBACK_HUES[key]);
  hues.core = read('--ev-core', FALLBACK_HUES.core);
  hues.tissue = read('--text-muted', FALLBACK_HUES.tissue);
  return hues;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A unit sphere folded into gyri — built once, shared by both hemispheres. */
function useCortexGeometry(): SphereGeometry {
  return useMemo(() => {
    const geometry = new SphereGeometry(1, 72, 48);
    const position = geometry.attributes.position!;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const lift = 1 + gyrusRipple(x, y, z);
      position.setXYZ(i, x * lift, y * lift, z * lift);
    }
    geometry.computeVertexNormals();
    return geometry;
  }, []);
}

const glowOf = (signal: EvermindRegionSignal) => 0.2 + signal.charge * 1.1;

export function EvermindBrain3D({ signals, names }: EvermindBrain3DProps) {
  const { theme } = useTheme();
  // The theme is the re-read trigger: the hues live in the document, not in `theme`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hues = useMemo(() => readHues(), [theme]);
  const still = useMemo(() => prefersReducedMotion(), []);
  const cortex = useCortexGeometry();
  const sway = useRef<Group>(null);
  const memories = useRef<Group>(null);
  const materials = useRef(new Map<string, { material: MeshStandardMaterial; key: EvermindRegionKey; phase: number }>());

  useFrame(({ clock }) => {
    if (still) return;
    const t = clock.getElapsedTime();
    // Sway, never spin: the brain turns enough to read as solid, never shows its back.
    if (sway.current) sway.current.rotation.y = Math.sin(t * 0.3) * 0.55;
    // Taught memories breathe with the hippocampus they are held in.
    if (memories.current) memories.current.position.y = Math.sin(t * 1.6) * 0.008;
    for (const { material, key, phase } of materials.current.values()) {
      const signal = signals[key];
      const pulse = signal.active ? 0.72 + 0.28 * Math.sin(t * 2.4 + phase) : 1;
      material.emissiveIntensity = glowOf(signal) * pulse;
    }
  });

  const register = (id: string, key: EvermindRegionKey, phase: number) => (material: MeshStandardMaterial | null) => {
    if (material) materials.current.set(id, { material, key, phase });
    else materials.current.delete(id);
  };

  const fitted = Math.min(signals.neocortex.count, MAX_MEMORY_DOTS);
  const taught = Math.min(signals.hippocampus.count, MAX_MEMORY_DOTS);
  const cortexGlow = 0.08 + signals.neocortex.charge * 0.35;

  return (
    <group ref={sway}>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * HEMISPHERE.offsetX, HEMISPHERE.centreY, 0]} scale={HEMISPHERE.radii}>
          <mesh geometry={cortex} castShadow>
            <meshStandardMaterial
              color={hues.neocortex}
              emissive={hues.neocortex}
              emissiveIntensity={cortexGlow}
              roughness={0.45}
              metalness={0.05}
              transparent
              opacity={0.24}
              depthWrite={false}
              side={DoubleSide}
            />
          </mesh>
          <mesh geometry={cortex}>
            <meshBasicMaterial color={hues.neocortex} wireframe transparent opacity={0.1} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <mesh position={CEREBELLUM.position} scale={CEREBELLUM.radii} geometry={cortex}>
        <meshStandardMaterial color={hues.tissue} transparent opacity={0.35} roughness={0.6} depthWrite={false} />
      </mesh>
      <mesh position={BRAINSTEM.position} rotation={[0.25, 0, 0]}>
        <cylinderGeometry args={[BRAINSTEM.radiusTop, BRAINSTEM.radiusBottom, BRAINSTEM.height, 20]} />
        <meshStandardMaterial color={hues.tissue} emissive={hues.core} emissiveIntensity={0.25} roughness={0.5} />
      </mesh>

      {EVERMIND_REGION_KEYS.map((key, regionIndex) => {
        const centre = BRAIN_CENTRES[key];
        return (
          <group key={key}>
            {centre.parts.map((part, partIndex) => (
              <group key={partIndex}>
                <mesh position={part.position} scale={part.radii}>
                  <sphereGeometry args={[1, 24, 16]} />
                  <meshStandardMaterial
                    ref={register(`${key}:${partIndex}`, key, regionIndex * 0.9 + partIndex * 0.4)}
                    color={hues[key]}
                    emissive={hues[key]}
                    emissiveIntensity={glowOf(signals[key])}
                    roughness={0.35}
                  />
                </mesh>
                {key !== 'thalamus' && (
                  <Line points={[part.position, PATHWAY_HUB]} color={hues[key]} lineWidth={1} transparent opacity={0.3 + signals[key].charge * 0.4} />
                )}
              </group>
            ))}
            <Html position={centre.label} center distanceFactor={7} zIndexRange={[5, 0]}>
              <span className={styles.label} aria-hidden="true" style={{ '--region-hue': `var(${REGION_HUE_VAR[key]})` } as CSSProperties}>
                {names[key]}
                {signals[key].count > 0 && <b className={styles.count}>{signals[key].count}</b>}
              </span>
            </Html>
          </group>
        );
      })}

      {Array.from({ length: fitted }, (_, index) => (
        <mesh key={`neo-${index}`} position={cortexMemorySpot(index, fitted)}>
          <sphereGeometry args={[0.016, 10, 8]} />
          <meshStandardMaterial color={hues.neocortex} emissive={hues.neocortex} emissiveIntensity={1.4} />
        </mesh>
      ))}
      <group ref={memories}>
        {Array.from({ length: taught }, (_, index) => (
          <mesh key={`hip-${index}`} position={hippocampalMemorySpot(index)}>
            <sphereGeometry args={[0.014, 10, 8]} />
            <meshStandardMaterial color={hues.hippocampus} emissive={hues.hippocampus} emissiveIntensity={1.2} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
