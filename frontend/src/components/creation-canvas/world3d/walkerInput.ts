/**
 * THE WALKER'S INPUT — one place every way of moving a body writes to.
 *
 * ── WHY IT IS A MODULE AND NOT A PROP ────────────────────────────────────────
 * `PlayerController` used to read the keyboard directly, which was fine while a
 * keyboard was the only thing that could move it. A phone has none, and a room
 * that walks like Roblox needs a look that is a right-drag or a finger rather than
 * a locked pointer. Threading every source through props would put the touch pad,
 * the drag-look and the keyboard on the controller's contract and on every host's.
 * Instead every source writes HERE — a key, a pad button, a finger, a wheel — and
 * the controller reads one set of keys, one look delta and one zoom, per frame.
 *
 * Deliberately module state rather than React state: it is sampled inside
 * `useFrame`, sixty times a second, and a re-render per keystroke would be the
 * wrong instrument. There is at most one walker on screen at a time (the room, the
 * 3D space and the play surface never mount together), so one shared input is the
 * truth and not a race.
 *
 * `takeLook` DRAINS: a look delta is consumed by the frame that reads it, so a
 * finger that stopped moving stops the camera.
 */

const keys = new Set<string>();
let lookX = 0;
let lookY = 0;
/** Third-person camera distance, in metres. Wheel and pinch change it. */
let zoom = 5;

export const WALKER_ZOOM_MIN = 2;
export const WALKER_ZOOM_MAX = 10;

/** The codes the walker understands. Everything else is somebody else's key. */
export const MOVEMENT_KEYS: ReadonlySet<string> = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'KeyJ',
]);

export function pressKey(code: string): void { keys.add(code); }
export function releaseKey(code: string): void { keys.delete(code); }
export function clearKeys(): void { keys.clear(); }
export function isPressed(code: string): boolean { return keys.has(code); }

/** Add a look delta, in radians: `dx` turns, `dy` tilts. */
export function addLook(dx: number, dy: number): void {
  lookX += dx;
  lookY += dy;
}

/** The accumulated look since the last frame, and reset it. */
export function takeLook(): { dx: number; dy: number } {
  const taken = { dx: lookX, dy: lookY };
  lookX = 0;
  lookY = 0;
  return taken;
}

export function walkerZoom(): number { return zoom; }

export function adjustZoom(delta: number): void {
  zoom = Math.min(WALKER_ZOOM_MAX, Math.max(WALKER_ZOOM_MIN, zoom + delta));
}

/**
 * The movement this frame asks for, from whatever is pressed.
 *
 * `z` is −1 forward / +1 back and `x` is −1 left / +1 right, in the walker's own
 * frame, before the camera's heading is applied — so the pad and the keyboard are
 * indistinguishable to the controller.
 */
export function movementIntent(): { x: number; z: number; jump: boolean } {
  const forward = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
  const back = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
  const left = keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0;
  const right = keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0;
  return { x: right - left, z: back - forward, jump: keys.has('Space') || keys.has('KeyJ') };
}
