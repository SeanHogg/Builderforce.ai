/*
 * No `'use client'` — mounted only inside the model surface, which is itself reached
 * through a `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useEffect, useMemo, type ReactNode } from 'react';
import { ExtrudeGeometry, Shape } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { materialColor, type Model3dEntity, type Model3dExtrusion, type Model3dState } from '@/lib/creation/model3d/model3dState';

export interface Model3dEntityMeshProps {
  entity: Model3dEntity;
  state: Model3dState;
  selection: ReadonlySet<string>;
  /** The theme accent, as a colour string, for the selected part's glow. */
  accent: string;
  onSelect?: (id: string, additive: boolean) => void;
  /** Nesting depth, to stop a malformed cycle of groups. */
  depth?: number;
  /** Drawn translucent: the part sits under a difference/intersection, which is not evaluated. */
  ghost?: boolean;
}

const MAX_DEPTH = 8;
const DEFAULT_SEGMENTS = 32;

/**
 * One entity as its three.js primitive, in the model's own Z-up space (the viewport
 * rotates the whole scene once). A group of parts renders its children inside it; a
 * difference or intersection is drawn translucent because it is not evaluated here — the
 * export says so too.
 */
export function Model3dEntityMesh({ entity, state, selection, accent, onSelect, depth = 0, ghost = false }: Model3dEntityMeshProps) {
  const selected = selection.has(entity.id);
  const color = materialColor(state, entity);
  const translucent = ghost;
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!onSelect) return;
    event.stopPropagation();
    onSelect(entity.id, event.nativeEvent.shiftKey || event.nativeEvent.ctrlKey || event.nativeEvent.metaKey);
  };
  const material = <PartMaterial color={color} accent={accent} selected={selected} translucent={translucent} />;
  const { translate, rotate, scale } = entity;
  const placement = {
    ...(translate ? { position: [translate.x, translate.y, translate.z] as [number, number, number] } : {}),
    ...(rotate ? { quaternion: rotate } : {}),
    ...(scale ? { scale: [scale.x, scale.y, scale.z] as [number, number, number] } : {}),
  };

  switch (entity.kind) {
    case 'box':
      return <group {...placement} onClick={handleClick}><mesh><boxGeometry args={[entity.widthMm, entity.depthMm, entity.heightMm]} />{material}</mesh></group>;
    case 'cylinder':
      // three's cylinder runs along Y; the model's runs along Z.
      return <group {...placement} onClick={handleClick}><mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[entity.radiusMm, entity.radiusMm, entity.heightMm, entity.segments ?? DEFAULT_SEGMENTS]} />{material}</mesh></group>;
    case 'sphere':
      return <group {...placement} onClick={handleClick}><mesh><sphereGeometry args={[entity.radiusMm, entity.segments ?? DEFAULT_SEGMENTS, Math.max(8, (entity.segments ?? DEFAULT_SEGMENTS) / 2)]} />{material}</mesh></group>;
    case 'extrude':
      return <group {...placement} onClick={handleClick}><ExtrudedPart entity={entity}>{material}</ExtrudedPart></group>;
    case 'boolean': {
      if (depth >= MAX_DEPTH) return null;
      const children = entity.children.flatMap((id) => state.entities.find((candidate) => candidate.id === id) ?? []);
      return <group {...placement} onClick={handleClick}>
        {children.map((child) => <Model3dEntityMesh key={child.id} entity={child} state={state} selection={selection} accent={accent} depth={depth + 1} ghost={ghost || entity.op !== 'union'} {...(onSelect ? { onSelect } : {})} />)}
      </group>;
    }
  }
}

function ExtrudedPart({ entity, children }: { entity: Model3dExtrusion; children: ReactNode }) {
  const geometry = useMemo(() => {
    const shape = new Shape();
    entity.profile.forEach((point, index) => (index ? shape.lineTo(point.x, point.y) : shape.moveTo(point.x, point.y)));
    shape.closePath();
    return new ExtrudeGeometry(shape, { depth: entity.depthMm, bevelEnabled: false });
  }, [entity.profile, entity.depthMm]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry}>{children}</mesh>;
}

function PartMaterial({ color, accent, selected, translucent }: { color: string; accent: string; selected: boolean; translucent: boolean }) {
  return <meshStandardMaterial color={color} emissive={selected ? accent : color} emissiveIntensity={selected ? 0.45 : 0} transparent={translucent} opacity={translucent ? 0.55 : 1} />;
}
