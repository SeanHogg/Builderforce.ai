/**
 * Which target runs the app — decided from the blueprint and the context, as DATA:
 * the targets in preference order (`RUN_TARGET_ORDER`), the first that accepts AND
 * starts wins. An execution's preview tries its container first (the run is there);
 * a project or canvas-app panel tries the browser first (free, no container; D7).
 * Every decline on the way is kept, so the surface can say why the app ran where it did.
 *
 * A target that starts on request (the browser: it spends the user's tab) is never
 * started by opening the preview: the outcome names it as `awaiting`, and the surface
 * offers Run, which calls `startRun` again with `requested: true`.
 */
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import { isPlanLimitError } from '@/lib/planLimitError';
import { browserRunTarget } from './browserRunTarget';
import { containerRunTarget } from './containerRunTarget';
import type { RunContext, RunDecline, RunSession, RunTarget, RunTargetId } from './runTarget';

export const RUN_TARGETS: Readonly<Record<RunTargetId, RunTarget>> = {
  browser: browserRunTarget,
  container: containerRunTarget,
};

/** Preference order by where the preview is opened from. */
export const RUN_TARGET_ORDER: Readonly<Record<'execution' | 'project', readonly RunTargetId[]>> = {
  execution: ['container', 'browser'],
  project: ['browser', 'container'],
};

/** The targets to try, in order, for this context. */
export function runTargetsFor(context: Pick<RunContext, 'executionId'>): RunTarget[] {
  const order = context.executionId != null ? RUN_TARGET_ORDER.execution : RUN_TARGET_ORDER.project;
  return order.map((id) => RUN_TARGETS[id]);
}

export interface TargetDecline extends RunDecline {
  targetId: RunTargetId;
}

export type RunOutcome =
  | { ok: true; session: RunSession; declined: TargetDecline[]; planLimit?: unknown }
  /** `awaiting` = this target would run it, once the user asks (Run). */
  | { ok: false; declined: TargetDecline[]; awaiting?: RunTargetId; planLimit?: unknown };

/** A plan-limit refusal (the container tier's `livePreview` 402), with the declines before it. */
export class RunPlanLimitError extends Error {
  constructor(readonly limit: unknown, readonly declined: TargetDecline[]) {
    super(limit instanceof Error ? limit.message : undefined, { cause: limit });
    this.name = 'RunPlanLimitError';
  }
}

/** The first target that accepts the blueprint, with the declines of those before it. */
export function chooseRunTarget(blueprint: AppBlueprint | null, targets: readonly RunTarget[]): {
  target: RunTarget | null;
  declined: TargetDecline[];
} {
  const declined: TargetDecline[] = [];
  for (const target of targets) {
    const verdict = target.accepts(blueprint);
    if (verdict.ok) return { target, declined };
    declined.push({ targetId: target.id, code: verdict.code, ...(verdict.detail ? { detail: verdict.detail } : {}) });
  }
  return { target: null, declined };
}

const declineOf = (targetId: RunTargetId, decline: RunDecline): TargetDecline =>
  ({ targetId, code: decline.code, ...(decline.detail ? { detail: decline.detail } : {}) });

/**
 * Start the app on the first target that can run it. A target that accepts but then
 * cannot start (no files, no live container, a start that throws) is a decline too,
 * and the next one is tried. A plan-limit refusal (the paid container tier) does not
 * end the search — the free browser tier may still run it (D7) — but is carried on the
 * outcome; when NO later target runs or awaits, it rejects with {@link RunPlanLimitError},
 * carrying the declines so far, so the surface renders its upgrade gate.
 */
export async function startRun(
  blueprint: AppBlueprint | null,
  context: RunContext,
  opts: { targets?: readonly RunTarget[]; requested?: boolean } = {},
): Promise<RunOutcome> {
  const declined: TargetDecline[] = [];
  let planLimit: unknown = undefined;
  const carried = () => (planLimit === undefined ? {} : { planLimit });
  let remaining = opts.targets ?? runTargetsFor(context);
  while (remaining.length > 0) {
    const choice = chooseRunTarget(blueprint, remaining);
    declined.push(...choice.declined);
    const target = choice.target;
    if (!target) break;
    if (target.startsOn === 'request' && !opts.requested) return { ok: false, declined, awaiting: target.id, ...carried() };
    try {
      const started = await target.start(blueprint, context);
      if (started.ok) return { ok: true, session: started.session, declined, ...carried() };
      declined.push(declineOf(target.id, started));
    } catch (error) {
      if (isPlanLimitError(error)) planLimit = error;
      else declined.push(declineOf(target.id, { code: 'runtimeUnavailable', detail: error instanceof Error ? error.message : String(error) }));
    }
    remaining = remaining.slice(remaining.indexOf(target) + 1);
  }
  if (planLimit !== undefined) throw new RunPlanLimitError(planLimit, declined);
  return { ok: false, declined };
}
