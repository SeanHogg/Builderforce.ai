/**
 * cloudLimbic — the cloud run's affective state: seeded from the assigned personas'
 * setpoints appraised against the task, evolved one durable tick at a time, and
 * recorded on the timeline. Moved verbatim out of `cloudAgentEngine.ts` (PRD 35 WS3).
 * The directive it compiles reaches the model through the adapter's per-turn
 * `ContextSource.turnSections`, never the persisted transcript.
 */
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { appraiseTask, compileLimbicState, neutralLimbicState, applyLimbicDelta, appraiseAmygdala, homeostasis, type LimbicState, type LimbicEvent } from '@seanhogg/builderforce-memory-engine/limbic';
import { recordCloudToolEvent } from './cloudToolEvents';
import { type Db } from '../../infrastructure/database/connection';

/** The affective state a cloud run starts in: the assigned personas' resting
 *  setpoints, appraised against the task text. Pure + Worker-safe. */
export function initialCloudLimbicState(
  taskRow: { title: string; description: string | null },
  setpoints?: LimbicState,
): LimbicState {
  return appraiseTask(`${taskRow.title}\n${taskRow.description ?? ''}`, setpoints ?? neutralLimbicState());
}

/** Map a finished tick's coarse outcome to an amygdala event. */
function cloudTickEvent(result: { ok: boolean; finished: boolean; cancelled: boolean }): LimbicEvent | null {
  if (result.cancelled) return { kind: 'idle', intensity: 0.4 };
  if (!result.ok) return { kind: 'error', intensity: 0.7 };
  if (result.finished) return { kind: 'success', intensity: 0.6 };
  return { kind: 'progress', intensity: 0.3 };
}

/**
 * Advance the cloud affect one DO tick: appraise the tick's outcome (amygdala),
 * then relax toward the personality setpoints (hypothalamus). Pure — the DO
 * persists the returned state in its cursor and feeds it back as the next tick's
 * `dynamicSystem` directive. This is the cross-tick evolution the seam enables.
 */
export function evolveCloudLimbicState(
  prev: LimbicState,
  setpoints: LimbicState | undefined,
  result: { ok: boolean; finished: boolean; cancelled: boolean },
): LimbicState {
  const ev = cloudTickEvent(result);
  const after = ev ? applyLimbicDelta(prev, appraiseAmygdala(ev)) : prev;
  return homeostasis(after, setpoints ?? neutralLimbicState(), { rate: 0.1 });
}

/** Record the affective state on the Observability timeline (best-effort). No-op
 *  when the state is at rest (no directives). */
export async function recordLimbicState(
  db: Db,
  args: { tenantId: number; cloudAgentRef?: string; executionId: number },
  state: LimbicState,
): Promise<void> {
  const { directives, params } = compileLimbicState(state);
  if (directives.length === 0) return;
  await recordCloudToolEvent(db, {
    tenantId: args.tenantId,
    cloudAgentRef: args.cloudAgentRef,
    executionId: args.executionId,
    toolName: 'limbic.appraise',
    category: 'context',
    detail: { state, params },
    result: `affective state: ${directives.length} directive(s)`,
  }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudLimbic.ts", operation: "recordLimbicState", context: { logMessage: '[cloud-run] limbic-state telemetry failed', details: { tenantId: args.tenantId, executionId: args.executionId, error } } }));
}
