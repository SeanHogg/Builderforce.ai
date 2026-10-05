/**
 * Phase readiness — whether the board holds what a phase NEEDS, derived, never stored.
 *
 * `canvasPhases.ts` says which phase a canvas is in and which surfaces that phase
 * offers. This answers the question one level down: is that phase POSSIBLE yet? Measure
 * on a board with nothing live has nothing to measure; Reach with nothing live has
 * nothing to put in front of people. The answer is read off the board's own objects:
 *
 *   - an idea      → `ideaLogEntries` (lib/ideaLog.ts)
 *   - an app       → `sessionHasApp` (lib/canvasSessionApp.ts)
 *   - live         → a `deployment` object carrying a url (`isLiveDeployment`,
 *                    lib/canvas/boardDeployments.ts — the one live predicate)
 *   - a metric     → `boardMetricDefinitions` (lib/canvas/boardMetrics.ts)
 *
 * ── WHY DERIVED AND NOT A COLUMN ──────────────────────────────────────────────────
 * Every signal already lives on the board. A stored readiness flag would be a second
 * copy of those facts that drifts the first time an object is deleted, so readiness is
 * a pure function of the nodes — one fact in one place.
 *
 * ── WHY "UNREADY" NEVER LOCKS ─────────────────────────────────────────────────────
 * A phase that is not ready still opens; every surface still works. Readiness drives a
 * path ("you are one step from Measure — deploy the app") and a ghost card, never a
 * refusal. The canvas never renders a wall.
 *
 * ── ADDING A REQUIREMENT ──────────────────────────────────────────────────────────
 * A row in `PHASE_REQUIREMENTS`, its satisfying phase in `SATISFIED_IN`, its signal in
 * `readinessSignals`. Never a branch on a phase name.
 *
 * Pure: no React, no storage, no network — so no cache either. The work is one O(n)
 * pass over the board, and `useCanvasPhaseReadiness` memoises it on a signature that a
 * drag does not change.
 */

import { CANVAS_PHASES, type CanvasPhase } from './canvasPhases';
import { ideaLogEntries } from './ideaLog';
import { sessionHasApp } from './canvasSessionApp';
import { boardMetricDefinitions } from './canvas/boardMetrics';
import { isLiveDeployment } from './canvas/boardDeployments';

export type PhaseRequirementId = 'idea' | 'app' | 'live' | 'metric';

export interface ReadinessSignals {
  hasIdea: boolean;
  hasApp: boolean;
  isLive: boolean;
  hasMetric: boolean;
}

export interface PhaseRequirement {
  id: PhaseRequirementId;
  /** The phase where this requirement is satisfied — where "Go to …" sends the reader. */
  satisfiedIn: CanvasPhase;
  met: boolean;
}

export interface CanvasPhaseReadiness {
  phase: CanvasPhase;
  /** Every REQUIRED requirement is met. */
  ready: boolean;
  /** Required and unmet, in arc order. */
  missing: readonly PhaseRequirement[];
  /** Recommended and unmet — a warning, never a gate (Reach without a metric). */
  advisories: readonly PhaseRequirement[];
  /** This phase's OWN output exists — the stepper's ✓. */
  done: boolean;
}

export interface ReadinessNode {
  id: string;
  data: Record<string, unknown>;
}

/** Requirements are cumulative and mirror the arc. Reach RECOMMENDS a metric: going out
 *  without measurement is allowed, but the canvas should say it is spending blind. */
const PHASE_REQUIREMENTS: Readonly<Record<CanvasPhase, { required: readonly PhaseRequirementId[]; recommended: readonly PhaseRequirementId[] }>> = {
  idea: { required: [], recommended: [] },
  make: { required: ['idea'], recommended: [] },
  run: { required: ['idea', 'app'], recommended: [] },
  measure: { required: ['idea', 'app', 'live'], recommended: [] },
  reach: { required: ['idea', 'app', 'live'], recommended: ['metric'] },
};

const SATISFIED_IN: Readonly<Record<PhaseRequirementId, CanvasPhase>> = { idea: 'idea', app: 'make', live: 'run', metric: 'measure' };

/** What each phase PRODUCES — its stepper ✓. Reach's output (a published listing or
 *  post) is not a board fact yet, so Reach is never "done" in this version. */
const PHASE_OUTPUT: Readonly<Record<CanvasPhase, PhaseRequirementId | null>> = { idea: 'idea', make: 'app', run: 'live', measure: 'metric', reach: null };

const SIGNAL_OF: Readonly<Record<PhaseRequirementId, keyof ReadinessSignals>> = { idea: 'hasIdea', app: 'hasApp', live: 'isLive', metric: 'hasMetric' };

export function readinessSignals(nodes: readonly ReadinessNode[]): ReadinessSignals {
  return {
    hasIdea: ideaLogEntries(nodes).length > 0,
    hasApp: sessionHasApp(nodes as ReadonlyArray<{ id: string; data: { [key: string]: unknown; kind: string } }>),
    isLive: nodes.some((node) => isLiveDeployment(node.data)),
    hasMetric: boardMetricDefinitions(nodes).length > 0,
  };
}

function requirement(id: PhaseRequirementId, signals: ReadinessSignals): PhaseRequirement {
  return { id, satisfiedIn: SATISFIED_IN[id], met: signals[SIGNAL_OF[id]] };
}

export function phaseReadiness(phase: CanvasPhase, signals: ReadinessSignals): CanvasPhaseReadiness {
  const rule = PHASE_REQUIREMENTS[phase];
  const missing = rule.required.map((id) => requirement(id, signals)).filter((entry) => !entry.met);
  const advisories = rule.recommended.map((id) => requirement(id, signals)).filter((entry) => !entry.met);
  const output = PHASE_OUTPUT[phase];
  return { phase, ready: missing.length === 0, missing, advisories, done: output ? signals[SIGNAL_OF[output]] : false };
}

export function readinessByPhase(signals: ReadinessSignals): Readonly<Record<CanvasPhase, CanvasPhaseReadiness>> {
  return Object.fromEntries(CANVAS_PHASES.map((phase) => [phase, phaseReadiness(phase, signals)])) as Record<CanvasPhase, CanvasPhaseReadiness>;
}

/**
 * The phase to OFFER next, or null: the one after `phase`, when the board already holds
 * this phase's output and the next is ready. The canvas never moves a reader on its own
 * (see `useCanvasSurfaceState`); this is what the path card offers instead.
 */
export function nextPhaseOffer(phase: CanvasPhase, byPhase: Readonly<Record<CanvasPhase, CanvasPhaseReadiness>>): CanvasPhase | null {
  const next = CANVAS_PHASES[CANVAS_PHASES.indexOf(phase) + 1];
  return next && byPhase[phase].done && byPhase[next].ready ? next : null;
}

/** The first phase whose own output does not exist yet — where a canvas with no stored
 *  phase opens. A board with everything through Measure opens in Reach. */
export function frontierPhase(signals: ReadinessSignals): CanvasPhase {
  return CANVAS_PHASES.find((phase) => !phaseReadiness(phase, signals).done) ?? CANVAS_PHASES[CANVAS_PHASES.length - 1]!;
}
