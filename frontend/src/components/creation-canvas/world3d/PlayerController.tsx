import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { PointerLockControls } from '@react-three/drei';
import { Group, Vector3, type PerspectiveCamera as ThreePerspectiveCamera } from 'three';
import type { CanvasWorldTransform } from '@builderforce/creation-canvas-contract';
import { AvatarFigure } from './PlayerAvatar';

/**
 * PlayerController — Rapier-driven first-person walker for walk mode.
 *
 * A capsule-collidered dynamic RigidBody with rotations locked (so it can't
 * tip over), driven by setting linear velocity each frame from WASD input +
 * a one-shot upward velocity on jump. The camera tracks the body and is
 * steered by drei's `<PointerLockControls>`.
 *
 * Ported from hired.video's `world-3d/PlayerController.tsx`. Trimmed: no
 * click-to-shoot hitscan and no multiplayer position broadcast — both are
 * game-engagement features this canvas's authoring surface doesn't need.
 * First/third-person camera framing is kept; it's a generically useful way
 * to "move a camera" through an authored space, not a game mechanic.
 */

const WALK_SPEED = 6; // m/s
const JUMP_IMPULSE = 6; // m/s upward velocity on jump
const GROUND_CHECK_DISTANCE = 0.15;
const EYE_HEIGHT = 0.7;
const THIRD_PERSON_DISTANCE = 5;
const THIRD_PERSON_HEIGHT = 1.2;
const CAMERA_WALL_PADDING = 0.4;

export const DEFAULT_WALKER_COLOR = '#38bdf8';

interface PlayerControllerProps {
  spawn: CanvasWorldTransform;
  /** Incrementing this teleports the walker back to spawn (the Respawn button). */
  respawnNonce?: number;
  /** `"first"` keeps the camera at the walker's eyes (body hidden); `"third"`
   *  orbits the camera behind a visible avatar. The host owns the toggle so
   *  the choice survives a respawn without re-mounting the controller. */
  cameraView?: 'first' | 'third';
  walkerColor?: string;
}

export default function PlayerController({
  spawn,
  respawnNonce = 0,
  cameraView = 'first',
  walkerColor = DEFAULT_WALKER_COLOR,
}: PlayerControllerProps) {
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const avatarRef = useRef<Group | null>(null);
  const camera = useThree((s) => s.camera) as ThreePerspectiveCamera;
  const keysRef = useRef<Set<string>>(new Set());
  const groundedRef = useRef(false);
  const { rapier, world } = useRapier();

  useEffect(() => {
    const down = (e: KeyboardEvent) => { keysRef.current.add(e.code); };
    const up = (e: KeyboardEvent) => { keysRef.current.delete(e.code); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.setTranslation({ x: spawn.position[0], y: spawn.position[1], z: spawn.position[2] }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }, [spawn.position, respawnNonce]);

  useFrame(() => {
    const body = bodyRef.current;
    if (!body) return;

    const translation = body.translation();
    const rayOrigin = { x: translation.x, y: translation.y - 0.9, z: translation.z };
    const ray = new rapier.Ray(rayOrigin, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, GROUND_CHECK_DISTANCE, true, undefined, undefined, undefined, body);
    groundedRef.current = hit != null;

    const keys = keysRef.current;
    const forward = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
    const back = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
    const left = keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0;
    const right = keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0;

    const inputZ = back - forward;
    const inputX = right - left;

    const camForward = new Vector3();
    camera.getWorldDirection(camForward);
    camForward.y = 0;
    camForward.normalize();
    const camRight = new Vector3(camForward.z, 0, -camForward.x);

    const velocity = new Vector3();
    velocity.addScaledVector(camForward, -inputZ);
    velocity.addScaledVector(camRight, inputX);
    if (velocity.lengthSq() > 0) velocity.normalize().multiplyScalar(WALK_SPEED);

    const currentVel = body.linvel();
    body.setLinvel({ x: velocity.x, y: currentVel.y, z: velocity.z }, true);

    if (groundedRef.current && (keys.has('Space') || keys.has('KeyJ'))) {
      body.setLinvel({ x: velocity.x, y: JUMP_IMPULSE, z: velocity.z }, true);
    }

    const headX = translation.x;
    const headY = translation.y + EYE_HEIGHT;
    const headZ = translation.z;

    if (cameraView === 'third') {
      const lookDir = new Vector3();
      camera.getWorldDirection(lookDir);

      let dist = THIRD_PERSON_DISTANCE;
      const backRay = new rapier.Ray({ x: headX, y: headY, z: headZ }, { x: -lookDir.x, y: -lookDir.y, z: -lookDir.z });
      const wallHit = world.castRay(backRay, THIRD_PERSON_DISTANCE, true, undefined, undefined, undefined, body);
      if (wallHit) dist = Math.max(0.5, wallHit.timeOfImpact - CAMERA_WALL_PADDING);
      camera.position.set(headX - lookDir.x * dist, headY + THIRD_PERSON_HEIGHT - lookDir.y * dist, headZ - lookDir.z * dist);

      const avatar = avatarRef.current;
      if (avatar) {
        avatar.position.set(translation.x, translation.y, translation.z);
        avatar.rotation.set(0, Math.atan2(-camForward.x, -camForward.z), 0);
      }
    } else {
      camera.position.set(headX, headY, headZ);
    }
  });

  return (
    <>
      {/* `walker: true` is how a sensor prop tells the player apart from a
          rolling sphere that happened to drop through it — see `PropMesh`. A
          collectible that any dynamic body could bank is not a collectible. */}
      <RigidBody ref={bodyRef} type="dynamic" position={spawn.position} colliders={false} enabledRotations={[false, false, false]} ccd canSleep={false} userData={{ walker: true }}>
        <CapsuleCollider args={[0.6, 0.4]} />
      </RigidBody>
      {/* Local avatar — only visible in third-person (you'd see the inside
          of your own head in first-person). Not a child of the RigidBody so
          it can yaw to the look direction independently of the
          rotation-locked body. */}
      <group ref={avatarRef} visible={cameraView === 'third'}>
        <AvatarFigure color={walkerColor} />
      </group>
      <PointerLockControls />
    </>
  );
}
