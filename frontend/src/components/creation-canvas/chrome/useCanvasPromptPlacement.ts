// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { effectiveCanvasPromptPlacement, type CanvasPromptPlacement } from '@/lib/canvasPromptPlacement';
import { useOnPreviewPick } from '@/lib/workspace/previewPick';
import type { BrainDockMode } from '../brainDockPreferences';

/** What decides where THE ONE COMPOSER goes on this render. */
export interface CanvasPromptPlacementInputs {
  /** The embedding host supplies the active surface (and so owns its input). */
  hostOwnsSurface: boolean;
  /** Brain IS the active surface (chat). */
  brainIsSurface: boolean;
  /** The person's stored placement. */
  preference: CanvasPromptPlacement;
  setPreference: (next: CanvasPromptPlacement) => void;
  brainSurfaceOpen: boolean;
  brainPlacement: BrainDockMode;
  /** The placement the active lens forces, or null. */
  lensPlacement: CanvasPromptPlacement | null | undefined;
}

export interface CanvasPromptPlacementState {
  /** The Brain panel is drawn as a dock beside the board. */
  brainDockDrawn: boolean;
  placement: CanvasPromptPlacement;
  /** The composer renders as the Brain panel's last row. */
  inBrainPanel: boolean;
}

/**
 * WHERE THE ONE COMPOSER GOES — see `effectiveCanvasPromptPlacement`. Also keeps a
 * pick in the App preview reachable: it lands as a chip in the prompt, so a closed
 * prompt reopens floating.
 */
export function useCanvasPromptPlacement(inputs: CanvasPromptPlacementInputs): CanvasPromptPlacementState {
  const brainDockDrawn = inputs.brainSurfaceOpen && inputs.brainPlacement === 'docked' && !inputs.brainIsSurface;
  const placement = effectiveCanvasPromptPlacement({
    hostOwnsSurface: inputs.hostOwnsSurface,
    brainIsSurface: inputs.brainIsSurface,
    preference: inputs.preference,
    brainDockDrawn,
    lensPlacement: inputs.lensPlacement,
  });
  const { setPreference } = inputs;
  useOnPreviewPick(() => { if (placement === 'closed') setPreference('float'); });
  return { brainDockDrawn, placement, inBrainPanel: placement === 'docked' };
}
