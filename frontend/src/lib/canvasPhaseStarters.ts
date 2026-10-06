/**
 * What a phase offers as a STARTING POINT, and what "Let Brain do the next step" asks.
 *
 * Two tables, both copy-free: every label and every prompt is a catalog key under
 * `creationCanvas.phaseStarters.<phase>.<key>` and `creationCanvas.requirement.<id>`, so
 * the five locales own the words and this file owns only which keys exist.
 *
 * - `PHASE_STARTERS` leads the composer's starting-points list when a canvas is in that
 *   phase — three per phase, the next useful thing to ask for.
 * - `REQUIREMENT_ACTIONS` is the one next step per missing requirement that the ghost card,
 *   the path card and the room's sign station all offer. One table, so the three never
 *   phrase the same next step three ways. Most are a prompt sent through the canvas's ONE
 *   turn door. A requirement the canvas performs ITSELF names an `act` instead, with its
 *   own `labelKey`: putting an app on the web is a person's press in the app's Publish
 *   panel, Brain has no deploy to run, and "Let Brain deploy it" was a promise Brain could
 *   only answer with an apology.
 *
 * Pure data.
 */
import type { CanvasPhase } from './canvasPhases';
import type { PhaseRequirementId } from './canvasPhaseReadiness';
import { cSuiteCanvasOwner } from './templates/promptUseCases';

export interface PhaseStarter {
  key: string;
}

export const PHASE_STARTERS: Readonly<Record<CanvasPhase, readonly PhaseStarter[]>> = {
  idea: [{ key: 'capture' }, { key: 'interview' }, { key: 'experiment' }],
  make: [{ key: 'spec' }, { key: 'app' }, { key: 'landing' }],
  run: [{ key: 'deploy' }, { key: 'release' }, { key: 'incident' }],
  measure: [{ key: 'metric' }, { key: 'dashboard' }, { key: 'experiment' }],
  reach: [{ key: 'post' }, { key: 'email' }, { key: 'listing' }],
};

/** What a phase's own "Let Brain …" asks for when the phase is READY — its first object. */
export const PHASE_PRIMARY_STARTER: Readonly<Record<CanvasPhase, string>> = {
  idea: 'capture',
  make: 'app',
  run: 'deploy',
  measure: 'metric',
  reach: 'post',
};

/** Something the canvas does itself for a requirement, rather than asking Brain. */
export type RequirementAct = 'publishApp';

export type RequirementAction =
  | { verbKey: string; promptKey: string }
  | { act: RequirementAct; labelKey: string };

export const REQUIREMENT_ACTIONS: Readonly<Record<PhaseRequirementId, RequirementAction>> = {
  idea: { verbKey: 'requirement.idea.verb', promptKey: 'requirement.idea.prompt' },
  app: { verbKey: 'requirement.app.verb', promptKey: 'requirement.app.prompt' },
  live: { act: 'publishApp', labelKey: 'requirement.live.act' },
  metric: { verbKey: 'requirement.metric.verb', promptKey: 'requirement.metric.prompt' },
};

/** The catalog keys of one phase starter, under `creationCanvas`. */
export function phaseStarterKeys(phase: CanvasPhase, key: string): { labelKey: string; promptKey: string } {
  return { labelKey: `phaseStarters.${phase}.${key}.label`, promptKey: `phaseStarters.${phase}.${key}.prompt` };
}

/**
 * Whether a starting-point CATEGORY serves a phase — the stages the C-suite owner table
 * already declares (`C_SUITE_CANVAS_OWNERS[...].stages`). A category with no owner
 * serves no particular phase and keeps its place after the ones that do.
 */
export function categoryServesPhase(category: string, phase: CanvasPhase): boolean {
  const owner = cSuiteCanvasOwner({ category, label: '', prompt: '' });
  return owner ? (owner.stages as readonly string[]).includes(phase) : false;
}
