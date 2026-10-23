/**
 * Tell the team a run was CONTAINED — stopped by one of its declared limits (spend,
 * files, repositories) before it finished.
 *
 * The loop already leaves the evidence on the run's own timeline (a `containment.limit`
 * tool event); this is the push half, so a stopped run reaches someone instead of
 * waiting to be noticed. Called from the containment branch of the cloud loop right
 * after that event is written. Fires once per run (the cooldown is keyed on the
 * execution) and never throws — see `raiseSystemAlert`.
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { millicentsToUsd } from '../../domain/shared/money';
import { raiseSystemAlert, SYSTEM_ALERT_METRICS, type SystemAlertOutcome } from './systemAlert';

/** Long enough that a run resumed after a stop does not re-announce the same limit. */
const CONTAINMENT_COOLDOWN_HOURS = 24;

export function containmentStopMessage(executionId: number, reason: string, taskId?: number | null): string {
  const task = taskId != null ? ` (ticket #${taskId})` : '';
  return `Run #${executionId}${task} was stopped by its containment limit: ${reason}.`;
}

export async function notifyContainmentStop(
  env: Env,
  db: Db,
  args: { tenantId: number; executionId: number; reason: string; taskId?: number | null; spendMillicents?: number | null },
): Promise<SystemAlertOutcome> {
  return raiseSystemAlert(env, db, {
    tenantId: args.tenantId,
    metric: SYSTEM_ALERT_METRICS.containmentStop,
    message: containmentStopMessage(args.executionId, args.reason, args.taskId),
    observedValue: args.spendMillicents != null ? millicentsToUsd(args.spendMillicents) : null,
    subjectKind: 'object',
    subjectRef: `execution:${args.executionId}`,
    severity: 'high',
    cooldownHours: CONTAINMENT_COOLDOWN_HOURS,
  });
}
