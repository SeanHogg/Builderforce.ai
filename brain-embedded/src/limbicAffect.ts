/**
 * The per-turn AFFECT block, appraised on this device — never a platform call.
 *
 * Every Brain host folds a fresh affect block into each turn's system prompt: the
 * limbic state after appraising THIS turn's text, seeded from the person's personality
 * ("personality = setpoints, limbic = dynamics"). Until 2026-10-21 each host POSTed the
 * text to `/api/limbic/block` per turn — a platform round-trip for a pure, deterministic
 * computation, which an anonymous or offline person could not make at all.
 *
 * The appraisal is Evermind's own limbic (`@seanhogg/builderforce-memory-engine/limbic`,
 * the dependency-free half; registered as `limbic.affect` in the ML task catalog, whose
 * heuristic regions are the trainable head's teacher and always-available answer), and
 * the personality projection is the shared psychometric vocabulary
 * (`@builderforce/agent-tools` `limbicTraits`). Both are composed here once, so the web
 * app, Rovr and the VS Code extension appraise a turn identically.
 *
 * The STATIC personality tone (`personaBlock`) is a separate, session-cached concern —
 * this module only renders the dynamic layer.
 */

import { limbicTraits, type PsychProfile } from '@builderforce/agent-tools';
import { appraiseTask, buildLimbicBlock, limbicSetpoints, neutralLimbicState, type LimbicState } from '@seanhogg/builderforce-memory-engine/limbic';

export type { LimbicState } from '@seanhogg/builderforce-memory-engine/limbic';

/**
 * The resting limbic state a personality relaxes toward — the seed every turn's
 * appraisal starts from. Neutral when there is no profile.
 */
export function personalitySetpoints(profile: PsychProfile | null | undefined): LimbicState {
  return profile ? limbicSetpoints(limbicTraits(profile)) : neutralLimbicState();
}

/**
 * The dynamic affect block for one turn: `text` appraised from `setpoints` (a
 * personality's resting state — {@link personalitySetpoints}; neutral when absent).
 * '' for an empty turn and at rest, so a no-op turn adds nothing to the prompt.
 */
export function turnAffectBlock(text: string, setpoints?: LimbicState | null): string {
  if (!text.trim()) return '';
  return buildLimbicBlock(appraiseTask(text, setpoints ?? neutralLimbicState()));
}
