import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CreationNodeData } from '../types';
import { useCreationNodeActions } from '../bodies/nodeActions';
import {
  duplicateFrame, frameIndex, frameLimit, insertFrameAfter, moveFrame, readAnimationState, removeFrame, totalDurationSec,
  updateAnimationSettings, updateFrameHold, updateFramePixels, type AnimationState,
} from '@/lib/creation/animation/animationState';
import { seedAnimationFromPreset } from '@/lib/creation/animation/animationPresets';
import { frameDelayMs } from '@/lib/creation/animation/animationExport';
import { useExportPalette } from '../creative/useExportPalette';

/**
 * The animation card's state: the strip stored on the object, which frame is selected,
 * and whether it is playing.
 *
 * The strip persists through the object's own `edit` action (`data.animation`), the
 * same path the drawing and the sheet use; selection and playback are local, so
 * clicking a frame or pressing play never writes to the board. `editable` is false
 * when the board gives the card no `edit`, and the editor draws no controls then.
 */
export function useAnimationEditor(data: CreationNodeData) {
  const { edit } = useCreationNodeActions();
  const stored = data.animation;
  const palette = useExportPalette();
  const state = useMemo(() => readAnimationState(stored, palette.paper), [stored, palette.paper]);
  const [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  /** A frame's pixels could not be stored (see `AnimationPaintStage`); cleared by the next one that is. */
  const [storeFailed, setStoreFailed] = useState(false);

  const activeId = state.frames.some((frame) => frame.id === selected) ? selected! : state.frames[0]!.id;
  const activeRef = useRef(activeId);
  useEffect(() => { activeRef.current = activeId; }, [activeId]);
  const editable = !!edit;

  const commit = useCallback((next: AnimationState) => {
    edit?.({ animation: next } as Partial<CreationNodeData>);
  }, [edit]);

  // Playback walks the strip, holding each frame for its own tick count.
  useEffect(() => {
    if (!playing) return;
    let index = Math.max(0, frameIndex(state, activeRef.current));
    let timer = 0;
    const step = (): void => {
      timer = window.setTimeout(() => {
        index = (index + 1) % state.frames.length;
        setSelected(state.frames[index]!.id);
        step();
      }, frameDelayMs(state.fps, state.frames[index]!.hold));
    };
    step();
    return () => window.clearTimeout(timer);
  }, [playing, state]);

  const select = useCallback((id: string) => { setPlaying(false); setSelected(id); }, []);

  const actions = useMemo(() => ({
    commitPixels: (frameId: string, url: string) => { setStoreFailed(false); commit(updateFramePixels(state, frameId, url)); },
    clearFrame: (frameId: string) => commit(updateFramePixels(state, frameId, null)),
    addFrame: () => { const result = insertFrameAfter(state, activeId); setSelected(result.newFrameId); commit(result.state); },
    duplicate: () => { const result = duplicateFrame(state, activeId); setSelected(result.newFrameId); commit(result.state); },
    remove: () => { const result = removeFrame(state, activeId); setSelected(result.selectedId); commit(result.state); },
    move: (delta: -1 | 1) => commit(moveFrame(state, activeId, frameIndex(state, activeId) + delta)),
    setHold: (hold: number) => commit(updateFrameHold(state, activeId, hold)),
    setSettings: (patch: Parameters<typeof updateAnimationSettings>[1]) => commit(updateAnimationSettings(state, patch)),
    applyPreset: (presetId: string) => { const seeded = seedAnimationFromPreset(presetId, palette.paper); setSelected(seeded.frames[0]!.id); commit(seeded); },
  }), [state, activeId, commit, palette.paper]);

  return {
    state, activeId, editable, playing, storeFailed, onStoreFailed: () => setStoreFailed(true), frameLimit: frameLimit(state), select, actions, palette,
    togglePlay: () => setPlaying((on) => !on && state.frames.length > 1),
    /** A preset only makes sense before anything is drawn: it replaces the whole strip. */
    canPickPreset: editable && state.frames.every((frame) => !frame.pixelsDataUrl),
    durationSec: totalDurationSec(state),
  };
}
