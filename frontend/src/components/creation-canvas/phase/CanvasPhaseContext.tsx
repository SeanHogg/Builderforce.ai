// No 'use client' directive, for the reason `canvasSurfaceActions.tsx` states at its top:
// every importer sits inside the `CreationCanvas` client boundary already.
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { CanvasPhase } from '@/lib/canvasPhases';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { phaseOutput, type CanvasPhaseReadiness, type PhaseRequirementId } from '@/lib/canvasPhaseReadiness';
import { phaseFocusOf, type PhaseFocus } from '@/lib/canvasPhaseLens';
import { PHASE_PRIMARY_STARTER, REQUIREMENT_ACTIONS, phaseStarterKeys, type RequirementAct } from '@/lib/canvasPhaseStarters';
import { readCanvasPhaseFocus, writeCanvasPhaseFocus } from '@/lib/canvasChrome';
import type { CanvasPhaseReadinessState } from '../hooks/useCanvasPhaseReadiness';
import type { CreationObjectKind } from '../types';

/**
 * THE PHASE, published once to everything that reads the session through it.
 *
 * The stepper, the board's lens, the ghost card, the path card, the command bar's tint,
 * the starting points and the room's stations all ask the same two questions — which
 * phase is this canvas in, and is it ready — and none of them is a child the host could
 * hand a prop to without threading it through four layers. So the host wraps its tree in
 * this provider once and each reader asks here. `CreationCanvas` holds no phase state of
 * its own beyond what `useCanvasSurfaceState` already held.
 *
 * The board-lens preference (`Phase focus`, ••• menu) is owned HERE rather than by the
 * host: it is read by the lens alone, and a host-held boolean would be one more entry in a
 * prop list that already carries fifty.
 *
 * Outside a canvas (a story, a test, the task drawer) every hook returns null, and every
 * reader treats null as "no phase" — draw nothing extra, change nothing.
 */
export interface CanvasPhaseValue {
  phase: CanvasPhase;
  setPhase: (phase: CanvasPhase) => void;
  readiness: CanvasPhaseReadinessState;
  /** `readiness.byPhase[phase]` — what every reader of "this phase" wants first. */
  current: CanvasPhaseReadiness;
  focusEnabled: boolean;
  setFocusEnabled: (enabled: boolean) => void;
  /** Start a Brain turn — the canvas's ONE turn door (queue, gate and all). */
  askBrain: (prompt: string) => void;
  /** Open the app's own Publish panel (or the account prompt on a board with no account). */
  publishApp: () => void;
  /** Put one object of `kind` at the viewport centre. Null when this viewer cannot edit. */
  appendAtCenter: ((kind: CreationObjectKind) => unknown) | null;
  /** Switch the board to a surface — "Open Ideas", "Open Operate" from a room station. */
  openSurface: (surface: CanvasSurfaceId) => void;
}

const CanvasPhaseContext = createContext<CanvasPhaseValue | null>(null);

function subscribeNever() {
  return () => {};
}
const focusServerSnapshot = () => true;

export interface CanvasPhaseProviderProps {
  phase: CanvasPhase;
  setPhase: (phase: CanvasPhase) => void;
  readiness: CanvasPhaseReadinessState;
  askBrain: (prompt: string) => void;
  publishApp: () => void;
  appendAtCenter: ((kind: CreationObjectKind) => unknown) | null;
  openSurface: (surface: CanvasSurfaceId) => void;
  children: ReactNode;
}

export function CanvasPhaseProvider({ phase, setPhase, readiness, askBrain, publishApp, appendAtCenter, openSurface, children }: CanvasPhaseProviderProps) {
  const storedFocus = useSyncExternalStore(subscribeNever, readCanvasPhaseFocus, focusServerSnapshot);
  const [focusChoice, setFocusChoice] = useState<boolean | null>(null);
  const focusEnabled = focusChoice ?? storedFocus;
  const setFocusEnabled = useCallback((enabled: boolean) => {
    setFocusChoice(enabled);
    writeCanvasPhaseFocus(enabled);
  }, []);
  const value = useMemo<CanvasPhaseValue>(() => ({
    phase, setPhase, readiness, current: readiness.byPhase[phase], focusEnabled, setFocusEnabled, askBrain, publishApp, appendAtCenter, openSurface,
  }), [appendAtCenter, askBrain, focusEnabled, openSurface, phase, publishApp, readiness, setFocusEnabled, setPhase]);
  return <CanvasPhaseContext.Provider value={value}>{children}</CanvasPhaseContext.Provider>;
}

/** The canvas's phase and readiness, or null outside a canvas. */
export function useCanvasPhase(): CanvasPhaseValue | null {
  return useContext(CanvasPhaseContext);
}

/** How a card of `kind` reads under the current phase's lens — null when the lens is
 *  off, outside a canvas, or the kind is structure (a frame). */
export function useCanvasPhaseFocus(kind: string): PhaseFocus | null {
  const value = useContext(CanvasPhaseContext);
  if (!value || !value.focusEnabled) return null;
  return phaseFocusOf(kind, value.phase);
}

/**
 * The next step — the ONE wording and the ONE send, shared by the ghost card, the path
 * card, the Operate and Insights surfaces and the room's sign station. Requirement steps
 * come from `REQUIREMENT_ACTIONS`: most are "Let Brain …" through the turn door, and one
 * the canvas performs itself (`act`) carries its own label. A ready phase's own first step
 * comes from `PHASE_PRIMARY_STARTER` — unless the phase's output is one of those acts (Run's
 * output is a live app), in which case it IS that act, so the two never disagree.
 */
export function useLetBrain() {
  const value = useContext(CanvasPhaseContext);
  const t = useTranslations('creationCanvas');
  return useMemo(() => {
    if (!value) return null;
    const acts: Readonly<Record<RequirementAct, () => void>> = { publishApp: value.publishApp };
    const requirementLabel = (id: PhaseRequirementId) => {
      const action = REQUIREMENT_ACTIONS[id];
      return 'act' in action
        ? t(action.labelKey as 'requirement.live.act')
        : t('phasePath.letBrain', { verb: t(action.verbKey as 'requirement.idea.verb') });
    };
    const runRequirement = (id: PhaseRequirementId) => {
      const action = REQUIREMENT_ACTIONS[id];
      if ('act' in action) acts[action.act]();
      else value.askBrain(t(action.promptKey as 'requirement.idea.prompt'));
    };
    const output = phaseOutput(value.phase);
    if (output && 'act' in REQUIREMENT_ACTIONS[output]) {
      return { requirementLabel, runRequirement, phaseLabel: requirementLabel(output), runPhase: () => runRequirement(output) };
    }
    const primary = phaseStarterKeys(value.phase, PHASE_PRIMARY_STARTER[value.phase]);
    const phaseLabel = t('phasePath.letBrain', { verb: t(`phaseGhost.verb.${value.phase}` as 'phaseGhost.verb.idea') });
    const runPhase = () => value.askBrain(t(primary.promptKey as 'phaseStarters.idea.capture.prompt'));
    return { requirementLabel, runRequirement, phaseLabel, runPhase };
  }, [t, value]);
}
