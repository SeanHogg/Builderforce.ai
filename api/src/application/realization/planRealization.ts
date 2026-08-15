/**
 * {@link RealizationTarget} + a brief → a {@link ChallengePlan}.
 *
 * The whole point of returning a ChallengePlan rather than a new shape: the
 * materialiser, the idempotent ticket seeding, the auto-run gate, the canvas
 * write contract and the readiness list already exist and are already correct.
 * A realization is a different ANSWER to "what should we build", not a different
 * way of building it.
 */

import type { BackendStrategyKey } from '../backend/hostingStrategy';
import { isBackendStrategy } from '../backend/hostingStrategy';
import type { ChallengePlan } from '../challenge/planChallenge';
import type { ChallengeSpec } from '../challenge/parseBrief';
import type { RealizationTarget } from './realizationTarget';

export interface PlanRealizationOptions {
  /** Where the backend runs. Honoured only when the target allows the choice. */
  strategy?: string | null;
  /**
   * The plan the challenge pipeline already produced for this brief, when there
   * is one. Only a target with `extendsBriefPlan` uses it — every other target
   * is a stand-in FOR the system, and inheriting the system's handlers would
   * make a smoke test deploy a webhook backend nobody asked it to.
   */
  briefPlan?: ChallengePlan | null;
}

/** Merge two `{ name → document }` maps, with the later one winning by key. */
function merge<T>(base: Readonly<Record<string, T>>, overlay: Readonly<Record<string, T>>): Record<string, T> {
  return { ...base, ...overlay };
}

/** Deduplicate by a key function, keeping the first occurrence. */
function distinctBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/**
 * Resolve the hosting strategy for one realization.
 *
 * A target that does not allow the choice gets its own, whatever was asked for.
 * That is not paternalism: `strategy: null` means the proof has no backend at
 * all, and honouring "deploy it to AWS" on a clickable prototype would generate
 * a deployment pipeline for a single HTML file.
 */
export function strategyFor(target: RealizationTarget, requested?: string | null): BackendStrategyKey {
  if (target.allowsStrategyChoice && isBackendStrategy(requested)) return requested;
  return target.strategy ?? 'declarative';
}

export interface RealizationBuild {
  plan: ChallengePlan;
  /** Site collections the generated forms post to. Created by the service. */
  collections: string[];
}

/**
 * Build the plan AND the collection list in one pass.
 *
 * One call to `target.build` because a target is only nominally pure — it
 * renders several kilobytes of markup, and calling it twice to read two fields
 * off the result is the kind of waste that is invisible until it is in a loop.
 */
export function planRealization(
  spec: ChallengeSpec,
  target: RealizationTarget,
  ingressUrl: string,
  options: PlanRealizationOptions = {},
): RealizationBuild {
  const output = target.build({ spec, ingressUrl });
  const base = target.extendsBriefPlan ? options.briefPlan ?? null : null;

  const plan: ChallengePlan = {
    // Namespaced so a realization can never be mistaken for a blueprint match:
    // the two answer different questions and share only a storage shape.
    blueprintKey: `realization:${target.key}`,
    blueprintName: target.name,
    matchScore: 1,
    matchReasons: [target.answers],
    considered: [],
    strategy: strategyFor(target, options.strategy),
    summary: output.summary,
    files: merge(base?.files ?? {}, output.files),
    handlers: merge(base?.handlers ?? {}, output.handlers),
    // A brief plan that dropped generated handlers said so, and that warning is
    // still true of the system this realization is making live.
    handlerWarnings: [...(base?.handlerWarnings ?? [])],
    tasks: [...(base?.tasks ?? []), ...output.tasks],
    requiredConnectors: distinctBy(
      [...(base?.requiredConnectors ?? []), ...output.requiredConnectors],
      (c) => c.key,
    ),
    requiredSecrets: distinctBy(
      [...(base?.requiredSecrets ?? []), ...output.requiredSecrets],
      (s) => s.name,
    ),
    // The proof's criteria come FIRST. When a realization extends the system's
    // plan, the question being answered is the proof's, and a list that opened
    // with the blueprint's acceptance criteria would bury it.
    successCriteria: distinctBy([...output.successCriteria, ...(base?.successCriteria ?? [])], (s) => s),
  };

  return { plan, collections: [...output.requiredCollections] };
}
