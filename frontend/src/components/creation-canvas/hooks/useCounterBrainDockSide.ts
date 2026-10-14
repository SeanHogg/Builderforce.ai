import { useSyncExternalStore } from 'react';
import { canvasLensDefinition, type CanvasLens } from '@/lib/canvasLens';
import {
  BRAIN_DOCK_CHANGED_EVENT,
  BRAIN_DOCK_STORAGE_KEY,
  DEFAULT_BRAIN_DOCK_PREFERENCES,
  readBrainDockPreferences,
  type BrainDockSide,
} from '../brainDockPreferences';

export function oppositeSide(side: BrainDockSide): BrainDockSide {
  return side === 'left' ? 'right' : 'left';
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === BRAIN_DOCK_STORAGE_KEY) onChange(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener(BRAIN_DOCK_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(BRAIN_DOCK_CHANGED_EVENT, onChange);
  };
}

const readSide = (): BrainDockSide => readBrainDockPreferences().side;
const serverSide = (): BrainDockSide => DEFAULT_BRAIN_DOCK_PREFERENCES.side;

/**
 * The edge OPPOSITE the Brain dock — where a surface docks its own panel so the
 * two never cover each other (PRD 33 §4.1: Measure ▸ Visitors docks the Insights
 * panel opposite the Brain). The dock side is the person's stored preference
 * (`brainDockPreferences`), followed live, unless the lens forces one
 * (`lib/canvasLens.ts`, Studio docks the Brain left) — a presentation that is
 * never written to the preference, so it is read from the lens here.
 *
 * Beside the dock module rather than in `lib/`: `lib/` does not reach into
 * `components/`, and the dock preference is a canvas component concern.
 */
export function useCounterBrainDockSide(lens?: CanvasLens): BrainDockSide {
  const stored = useSyncExternalStore(subscribe, readSide, serverSide);
  const forced = lens ? canvasLensDefinition(lens).brainDock?.side ?? null : null;
  return oppositeSide(forced ?? stored);
}
