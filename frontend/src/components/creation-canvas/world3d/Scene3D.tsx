import { OrbitControls } from '@react-three/drei';
import { CuboidCollider, Physics, RigidBody } from '@react-three/rapier';
import type { ThreeEvent } from '@react-three/fiber';
import type { CanvasWorldScene } from '@builderforce/creation-canvas-contract';
import PropMesh from './PropMesh';
import PlayerController from './PlayerController';

/**
 * Scene3D — the R3F `<Canvas>` contents. Mounts lights, sky, ground, every
 * prop, the spawn gizmo (edit mode), and the walker (walk mode). Stays
 * presentational — authoring mutations (place / select / move) are wired by
 * the host `CanvasWorldView` through the props it passes here.
 *
 * Ported from hired.video's `world-3d/Scene3D.tsx`. Trimmed: no multiplayer
 * peers, no challenge/trigger event bus.
 */

interface Scene3DProps {
  scene: CanvasWorldScene;
  mode: 'edit' | 'walk';
  selectedPropId: string | null;
  onSelectProp: (id: string | null) => void;
  respawnNonce?: number;
  cameraView?: 'first' | 'third';
  walkerColor?: string;
}

export default function Scene3D({ scene, mode, selectedPropId, onSelectProp, respawnNonce = 0, cameraView = 'first', walkerColor }: Scene3DProps) {
  const sunPosition: [number, number, number] = [
    -scene.lighting.sun.direction[0] * 30,
    -scene.lighting.sun.direction[1] * 30,
    -scene.lighting.sun.direction[2] * 30,
  ];

  const handleGroundClick = (_event: ThreeEvent<MouseEvent>) => {
    if (mode !== 'edit') return;
    onSelectProp(null);
  };

  return (
    <>
      <color attach="background" args={[scene.skyColor]} />
      <fog attach="fog" args={[scene.skyColor, 50, 200]} />

      <ambientLight intensity={scene.lighting.ambient.intensity} color={scene.lighting.ambient.color} />
      <directionalLight
        position={sunPosition}
        intensity={scene.lighting.sun.intensity}
        color={scene.lighting.sun.color}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />

      <Physics gravity={[0, -9.81, 0]} paused={mode === 'edit'}>
        <RigidBody type="fixed" colliders={false} position={[0, -0.5, 0]}>
          <CuboidCollider args={[scene.ground.size / 2, 0.5, scene.ground.size / 2]} />
          <mesh receiveShadow onClick={handleGroundClick} position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[scene.ground.size, scene.ground.size]} />
            <meshStandardMaterial color={scene.ground.color} />
          </mesh>
        </RigidBody>

        {scene.props.map((prop) => (
          <PropMesh key={prop.id} prop={prop} mode={mode} selected={mode === 'edit' && prop.id === selectedPropId} onSelect={onSelectProp} />
        ))}

        {mode === 'edit' && (
          <mesh position={scene.spawn.position} rotation={scene.spawn.rotation}>
            <cylinderGeometry args={[0.6, 0.6, 2, 24]} />
            <meshStandardMaterial color="#22c55e" transparent opacity={0.35} emissive="#22c55e" emissiveIntensity={0.5} />
          </mesh>
        )}

        {mode === 'walk' && (
          <PlayerController spawn={scene.spawn} respawnNonce={respawnNonce} cameraView={cameraView} walkerColor={walkerColor} />
        )}
      </Physics>

      {mode === 'edit' && (
        <OrbitControls enableDamping dampingFactor={0.1} target={[0, 1, 0]} maxPolarAngle={Math.PI / 2 - 0.05} />
      )}
    </>
  );
}
