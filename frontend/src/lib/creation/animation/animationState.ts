import { resolveExportColor } from '../exportColors';
/**
 * The animation object's authored state: a strip of raster frames plus the playback
 * settings that govern them. It lives on the object as `data.animation` and
 * round-trips as JSON, so each frame carries its pixels as a PNG data URL.
 *
 * Which frame is selected is NOT here — that is ephemeral editor state, and writing
 * it to the object would make every click a board change.
 *
 * Every function is pure and returns a new state; unchanged frames stay reference-equal.
 */

export const ANIMATION_SCHEMA_VERSION = 1;
export const DEFAULT_ANIMATION_WIDTH = 480;
export const DEFAULT_ANIMATION_HEIGHT = 480;
export const DEFAULT_ANIMATION_FPS = 12;
export const MAX_ANIMATION_SIDE = 1920;
export const MAX_ANIMATION_FPS = 60;
export const MAX_FRAME_HOLD = 30;
export const MAX_ONION_DEPTH = 3;
/** A strip longer than this is not an editable card; add and duplicate refuse past it. */
export const MAX_FRAMES = 120;
/**
 * Total characters of INLINE frame pixels (data URLs) the strip may hold. Frames are
 * uploaded and the strip keeps URLs, so this only bounds the guest fallback, where
 * nothing can be uploaded and each frame is a small data URL (see `storeCreationFile`).
 * Add and duplicate refuse once it is spent; drawing on an existing frame is never refused.
 */
export const MAX_ANIMATION_CHARS = 1_500_000;

const inlineChars = (url: string | null): number => (url?.startsWith('data:') ? url.length : 0);

/** Why the strip cannot take another frame, or null when it can. */
export type FrameLimit = 'maxFrames' | 'budget';
export function frameLimit(state: AnimationState, extraChars = 0): FrameLimit | null {
  if (state.frames.length >= MAX_FRAMES) return 'maxFrames';
  const chars = state.frames.reduce((sum, frame) => sum + inlineChars(frame.pixelsDataUrl), 0);
  return chars + extraChars > MAX_ANIMATION_CHARS ? 'budget' : null;
}

export interface AnimationFrame {
  id: string;
  /** The frame's PNG at the animation's width x height: an uploaded https URL, or (guest only) a data URL; null for a blank frame. */
  pixelsDataUrl: string | null;
  /** Ticks this frame is held for (the exposure-sheet convention). Default 1. */
  hold: number;
}

export type AnimationBackground = { kind: 'transparent' } | { kind: 'color'; color: string };

export interface AnimationState {
  schemaVersion: number;
  width: number;
  height: number;
  fps: number;
  background: AnimationBackground;
  frames: AnimationFrame[];
  /** Previous frames shown faintly behind the active one. 0 turns it off. */
  onionSkinDepth: number;
  /** 0 = loop forever. */
  loopCount: number;
}

export function makeFrameId(): string {
  return `frame-${Math.random().toString(36).slice(2, 10)}`;
}

/** `paper` is the export palette's `paper` (resolved by the caller): the colour a fresh strip is painted on. */
export function createBlankAnimationState(
  paper: string = resolveExportColor('paper'),
  width = DEFAULT_ANIMATION_WIDTH,
  height = DEFAULT_ANIMATION_HEIGHT,
  background: AnimationBackground = { kind: 'color', color: paper },
  fps = DEFAULT_ANIMATION_FPS,
): AnimationState {
  return {
    schemaVersion: ANIMATION_SCHEMA_VERSION,
    width, height, fps, background,
    frames: [{ id: makeFrameId(), pixelsDataUrl: null, hold: 1 }],
    onionSkinDepth: 1,
    loopCount: 0,
  };
}

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, n));
};

/**
 * Whatever is stored on the object, made into a state the editor can trust.
 *
 * The field is written by the editor, by Brain's `canvas_update_object` and by older
 * clients, so every field is checked here rather than assumed. A missing or unusable
 * value yields a blank state; a usable one keeps its frames.
 */
export function readAnimationState(value: unknown, paper: string = resolveExportColor('paper')): AnimationState {
  if (!value || typeof value !== 'object') return createBlankAnimationState(paper);
  const raw = value as Record<string, unknown>;
  const frames: AnimationFrame[] = Array.isArray(raw.frames)
    ? raw.frames.flatMap((entry): AnimationFrame[] => {
      if (!entry || typeof entry !== 'object') return [];
      const frame = entry as Record<string, unknown>;
      return [{
        id: typeof frame.id === 'string' && frame.id ? frame.id : makeFrameId(),
        pixelsDataUrl: typeof frame.pixelsDataUrl === 'string' && (frame.pixelsDataUrl.startsWith('data:image/') || /^https:\/\//i.test(frame.pixelsDataUrl)) ? frame.pixelsDataUrl : null,
        hold: clampInt(frame.hold, 1, 1, MAX_FRAME_HOLD),
      }];
    }).slice(0, MAX_FRAMES)
    : [];
  const background = raw.background as Record<string, unknown> | undefined;
  const base = createBlankAnimationState(paper);
  return {
    schemaVersion: ANIMATION_SCHEMA_VERSION,
    width: clampInt(raw.width, base.width, 16, MAX_ANIMATION_SIDE),
    height: clampInt(raw.height, base.height, 16, MAX_ANIMATION_SIDE),
    fps: clampInt(raw.fps, base.fps, 1, MAX_ANIMATION_FPS),
    background: background?.kind === 'transparent'
      ? { kind: 'transparent' }
      : { kind: 'color', color: typeof background?.color === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(background.color) ? background.color : paper },
    frames: frames.length ? frames : base.frames,
    onionSkinDepth: clampInt(raw.onionSkinDepth, base.onionSkinDepth, 0, MAX_ONION_DEPTH),
    loopCount: clampInt(raw.loopCount, 0, 0, 65535),
  };
}

export function frameIndex(state: AnimationState, frameId: string): number {
  return state.frames.findIndex((frame) => frame.id === frameId);
}

/** Total playback time in seconds, honouring each frame's hold. */
export function totalDurationSec(state: AnimationState): number {
  if (state.fps <= 0) return 0;
  return state.frames.reduce((ticks, frame) => ticks + Math.max(1, frame.hold), 0) / state.fps;
}

export function updateFramePixels(state: AnimationState, frameId: string, pixelsDataUrl: string | null): AnimationState {
  return { ...state, frames: state.frames.map((frame) => frame.id === frameId ? { ...frame, pixelsDataUrl } : frame) };
}

export function updateFrameHold(state: AnimationState, frameId: string, hold: number): AnimationState {
  const clamped = clampInt(hold, 1, 1, MAX_FRAME_HOLD);
  return { ...state, frames: state.frames.map((frame) => frame.id === frameId ? { ...frame, hold: clamped } : frame) };
}

/** A blank frame right after `afterFrameId` (at the end when the id is unknown). Refused, state unchanged, past `frameLimit`. */
export function insertFrameAfter(state: AnimationState, afterFrameId: string): { state: AnimationState; newFrameId: string } {
  if (frameLimit(state)) return { state, newFrameId: afterFrameId };
  const index = frameIndex(state, afterFrameId);
  const frame: AnimationFrame = { id: makeFrameId(), pixelsDataUrl: null, hold: 1 };
  const frames = [...state.frames];
  frames.splice(index === -1 ? frames.length : index + 1, 0, frame);
  return { state: { ...state, frames }, newFrameId: frame.id };
}

/** A copy of the frame right after it — "tween by hand": duplicate, then nudge. */
export function duplicateFrame(state: AnimationState, frameId: string): { state: AnimationState; newFrameId: string } {
  const index = frameIndex(state, frameId);
  if (index === -1) return { state, newFrameId: frameId };
  const source = state.frames[index]!;
  if (frameLimit(state, inlineChars(source.pixelsDataUrl))) return { state, newFrameId: frameId };
  const copy: AnimationFrame = { ...source, id: makeFrameId() };
  const frames = [...state.frames];
  frames.splice(index + 1, 0, copy);
  return { state: { ...state, frames }, newFrameId: copy.id };
}

/** Remove a frame; a strip always keeps at least one, so removing the last is a no-op.
 *  `selectedId` is whichever frame the editor should select afterwards. */
export function removeFrame(state: AnimationState, frameId: string): { state: AnimationState; selectedId: string } {
  const index = frameIndex(state, frameId);
  if (state.frames.length <= 1 || index === -1) return { state, selectedId: frameId };
  const frames = state.frames.filter((frame) => frame.id !== frameId);
  return { state: { ...state, frames }, selectedId: frames[Math.max(0, index - 1)]!.id };
}

/** Move a frame to `destIndex`, clamped to the strip. */
export function moveFrame(state: AnimationState, frameId: string, destIndex: number): AnimationState {
  const index = frameIndex(state, frameId);
  if (index === -1) return state;
  const target = Math.max(0, Math.min(state.frames.length - 1, destIndex));
  if (target === index) return state;
  const frames = [...state.frames];
  const [moved] = frames.splice(index, 1);
  frames.splice(target, 0, moved!);
  return { ...state, frames };
}

export function updateAnimationSettings(
  state: AnimationState,
  patch: Partial<Pick<AnimationState, 'width' | 'height' | 'fps' | 'background' | 'onionSkinDepth' | 'loopCount'>>,
): AnimationState {
  return { ...state, ...patch };
}
