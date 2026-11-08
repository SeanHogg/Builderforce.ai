/**
 * Starting points for a new animation: canvas size, frame rate and how many blank
 * frames the strip begins with, so a fresh object opens on a loop that can be painted
 * straight away instead of a single empty frame.
 */
import { resolveExportColor } from '../exportColors';
import { createBlankAnimationState, insertFrameAfter, type AnimationState } from './animationState';

export type AnimationPresetId = 'logoLoop' | 'spinner' | 'reaction' | 'explainer';

export interface AnimationPreset {
  id: AnimationPresetId;
  width: number;
  height: number;
  fps: number;
  starterFrames: number;
}

export const ANIMATION_PRESETS: readonly AnimationPreset[] = [
  // Square brand bug, smooth at 24 fps: room for a wipe, spin or pulse.
  { id: 'logoLoop', width: 512, height: 512, fps: 24, starterFrames: 8 },
  // Small and fluid at 30 fps; six frames is the canonical spinner cadence.
  { id: 'spinner', width: 256, height: 256, fps: 30, starterFrames: 6 },
  // Social reaction clip: 480 square at 15 fps, about 0.8 s.
  { id: 'reaction', width: 480, height: 480, fps: 15, starterFrames: 12 },
  // 16:9 mini explainer at 12 fps ("on 2s") so it reads as drawn rather than computed.
  { id: 'explainer', width: 640, height: 360, fps: 12, starterFrames: 16 },
];

export function animationPreset(id: string): AnimationPreset | null {
  return ANIMATION_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** A fresh strip for the preset; an unknown id yields the blank single-frame default. */
export function seedAnimationFromPreset(id: string, paper: string = resolveExportColor('paper')): AnimationState {
  const preset = animationPreset(id);
  if (!preset) return createBlankAnimationState(paper);
  let state = createBlankAnimationState(paper, preset.width, preset.height, { kind: 'color', color: paper }, preset.fps);
  for (let i = 1; i < preset.starterFrames; i++) {
    state = insertFrameAfter(state, state.frames[state.frames.length - 1]!.id).state;
  }
  return state;
}
