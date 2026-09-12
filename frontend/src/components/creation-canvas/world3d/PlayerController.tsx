import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { PointerLockControls } from '@react-three/drei';
import { Euler, Group, Vector3, type PerspectiveCamera as ThreePerspectiveCamera } from 'three';
import type { CanvasWorldTransform } from '@builderforce/creation-canvas-contract';
import { isTypingTarget } from '@/lib/keyboardTarget';
import { AvatarFigure } from './PlayerAvatar';
import {
  MOVEMENT_KEYS, clearKeys, movementIntent, pressKey, releaseKey, takeLook, walkerZoom,
} from './walkerInput';

/**
 * PlayerController — Rapier-driven walker for walk mode.
 *
 * A capsule-collidered dynamic RigidBody with rotations locked (so it can't
 * tip over), driven by setting linear velocity each frame from the shared
 * walker input (`walkerInput.ts`: keyboard, touch pad, drag-look) + a one-shot
 * upward velocity on jump. The camera tracks the body.
 *
 * ── TWO WAYS TO LOOK ─────────────────────────────────────────────────────────
 * `look: 'pointerLock'` is the 3D space's and the play surface's: click the
 * canvas, the pointer locks, the mouse turns the head — the idiom of a
 * first-person game. `look: 'drag'` is the ROOM's, and it is Roblox's: nothing
 * locks, a right-drag or a finger turns the camera, the wheel zooms the
 * third-person distance, and the left button stays free for the room's own
 * buttons and drags. Both feed `addLook`; only the source differs. Whichever
 * mode is on, a finger on the viewport feeds it too (`useDragLook`), so a phone
 * can look round either surface.
 *
 * Ported from hired.video's `world-3d/PlayerController.tsx`. Trimmed: no
 * click-to-shoot hitscan; the position broadcast came back as `onMove`, because
 * the room draws everyone else where they really are.
 */

const WALK_SPEED = 6; // m/s
const JUMP_IMPULSE = 6; // m/s upward velocity on jump
const GROUND_CHECK_DISTANCE = 0.15;
const EYE_HEIGHT = 0.7;
const THIRD_PERSON_HEIGHT = 1.2;
const CAMERA_WALL_PADDING = 0.4;
/** Straight up or straight down is a view of the walker's own capsule. */
const PITCH_LIMIT = Math.PI / 2 - 0.08;

export const DEFAULT_WALKER_COLOR = '#38bdf8';

export type WalkerLook = 'pointerLock' | 'drag';

interface PlayerControllerProps {
  spawn: CanvasWorldTransform;
  /** Incrementing this teleports the walker back to spawn (the Respawn button). */
  respawnNonce?: number;
  /** `"first"` keeps the camera at the walker's eyes (body hidden); `"third"`
   *  orbits the camera behind a visible avatar. The host owns the toggle so
   *  the choice survives a respawn without re-mounting the controller. */
  cameraView?: 'first' | 'third';
  walkerColor?: string;
  /** How the camera is turned — see the header. Default: pointer lock. */
  look?: WalkerLook;
  /**
   * Where the walker is, every frame it moved. The room relays this as the
   * viewer's body so peers see them walk. Throttle in the caller; this is
   * called at frame rate.
   */
  onMove?: (position: [number, number, number], yaw: number) => void;
}

export default function PlayerController({
  spawn,
  respawnNonce = 0,
  cameraView = 'first',
  walkerColor = DEFAULT_WALKER_COLOR,
  look = 'pointerLock',
  onMove,
}: PlayerControllerProps) {
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const avatarRef = useRef<Group | null>(null);
  const camera = useThree((s) => s.camera) as ThreePerspectiveCamera;
  const groundedRef = useRef(false);
  const { rapier, world } = useRapier();
  const onMoveRef = useRef(onMove);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);
  // Yaw/pitch the drag-look steers. Seeded from wherever the camera was
  // pointing when walking began, so the first drag turns from there.
  const eulerRef = useRef<Euler | null>(null);

  /**
   * The keys the walker owns while it is walking, and the reason it takes them.
   *
   * Every one of these has a default action in a browser: the arrows and Space
   * scroll the document. The canvas that hosts this runtime scrolls, so walking
   * backwards scrolled the page out from under the game and jumping paged it
   * down. A key this controller reads is a key the browser does not get to act
   * on as well. `isTypingTarget` keeps that from stealing the arrows out of the
   * prompt sitting on the same page: a keystroke aimed at a field is never a
   * movement key.
   */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!MOVEMENT_KEYS.has(e.code) || isTypingTarget(e.target)) return;
      e.preventDefault();
      pressKey(e.code);
    };
    const up = (e: KeyboardEvent) => { releaseKey(e.code); };
    // A key released while this window is in the background never reports its
    // keyup, so the walker would come back from a tab switch still running in the
    // last direction it was pushed, with no key to press to stop it.
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clearKeys);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clearKeys);
      clearKeys();
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

    // Drag-look: apply whatever the pointer or finger accumulated since last frame.
    if (look === 'drag') {
      if (!eulerRef.current) eulerRef.current = new Euler(0, 0, 0, 'YXZ').setFromQuaternion(camera.quaternion, 'YXZ');
      const { dx, dy } = takeLook();
      if (dx !== 0 || dy !== 0) {
        eulerRef.current.y -= dx;
        eulerRef.current.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, eulerRef.current.x - dy));
      }
      camera.quaternion.setFromEuler(eulerRef.current);
    } else {
      // Pointer lock owns the mouse; a finger still contributes through the same
      // accumulator, applied the way PointerLockControls would have.
      const { dx, dy } = takeLook();
      if (dx !== 0 || dy !== 0) {
        const euler = new Euler(0, 0, 0, 'YXZ').setFromQuaternion(camera.quaternion, 'YXZ');
        euler.y -= dx;
        euler.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, euler.x - dy));
        camera.quaternion.setFromEuler(euler);
      }
    }

    const translation = body.translation();
    const rayOrigin = { x: translation.x, y: translation.y - 0.9, z: translation.z };
    const ray = new rapier.Ray(rayOrigin, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, GROUND_CHECK_DISTANCE, true, undefined, undefined, undefined, body);
    groundedRef.current = hit != null;

    const intent = movementIntent();

    const camForward = new Vector3();
    camera.getWorldDirection(camForward);
    camForward.y = 0;
    camForward.normalize();
    const camRight = new Vector3(camForward.z, 0, -camForward.x);

    const velocity = new Vector3();
    velocity.addScaledVector(camForward, -intent.z);
    velocity.addScaledVector(camRight, intent.x);
    if (velocity.lengthSq() > 0) velocity.normalize().multiplyScalar(WALK_SPEED);

    const currentVel = body.linvel();
    body.setLinvel({ x: velocity.x, y: currentVel.y, z: velocity.z }, true);

    if (groundedRef.current && intent.jump) {
      body.setLinvel({ x: velocity.x, y: JUMP_IMPULSE, z: velocity.z }, true);
    }

    const headX = translation.x;
    const headY = translation.y + EYE_HEIGHT;
    const headZ = translation.z;
    const yaw = Math.atan2(-camForward.x, -camForward.z);

    if (cameraView === 'third') {
      const lookDir = new Vector3();
      camera.getWorldDirection(lookDir);

      let dist = walkerZoom();
      const backRay = new rapier.Ray({ x: headX, y: headY, z: headZ }, { x: -lookDir.x, y: -lookDir.y, z: -lookDir.z });
      const wallHit = world.castRay(backRay, dist, true, undefined, undefined, undefined, body);
      if (wallHit) dist = Math.max(0.5, wallHit.timeOfImpact - CAMERA_WALL_PADDING);
      camera.position.set(headX - lookDir.x * dist, headY + THIRD_PERSON_HEIGHT - lookDir.y * dist, headZ - lookDir.z * dist);

      const avatar = avatarRef.current;
      if (avatar) {
        avatar.position.set(translation.x, translation.y, translation.z);
        avatar.rotation.set(0, yaw, 0);
      }
    } else {
      camera.position.set(headX, headY, headZ);
    }

    // The body's FEET, which is what a peer avatar is placed by.
    onMoveRef.current?.([translation.x, translation.y - 1.0, translation.z], yaw);
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
      {look === 'pointerLock' && <PointerLockControls />}
    </>
  );
}
