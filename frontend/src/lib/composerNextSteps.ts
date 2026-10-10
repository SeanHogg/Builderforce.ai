import { PHASE_STARTERS, phaseStarterKeys } from './canvasPhaseStarters';
import type { CanvasPhase } from './canvasPhases';
import type { CanvasSurfaceDef } from './canvasSurfaces';

/** One chip: catalog keys under `creationCanvas`, so the five locales own the words. */
export interface ComposerNextStep {
  id: string;
  labelKey: string;
  promptKey: string;
}

/**
 * What the composer suggests next, as DATA: the surface's own fixed list when it declares
 * one (the App surface: polish, phones, a section, real copy, fix errors), else the
 * canvas phase's starters. Never a model call — a suggestion that costs a turn to
 * produce is a turn the person did not ask for.
 */
export function composerNextSteps(surface: Pick<CanvasSurfaceDef, 'id' | 'composerNextSteps'>, phase: CanvasPhase | null | undefined): readonly ComposerNextStep[] {
  if (surface.composerNextSteps?.length) {
    return surface.composerNextSteps.map((key) => ({
      id: `${surface.id}:${key}`,
      labelKey: `nextSteps.${surface.id}.${key}.label`,
      promptKey: `nextSteps.${surface.id}.${key}.prompt`,
    }));
  }
  if (!phase) return [];
  return PHASE_STARTERS[phase].map((starter) => ({ id: `${phase}:${starter.key}`, ...phaseStarterKeys(phase, starter.key) }));
}
