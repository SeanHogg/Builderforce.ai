import type { Deadline, HealthStatus } from '../../domain/deadlines/Deadline';

/**
 * Compute the health status for a deadline based on its due date, forecast,
 * dependencies, and the configured warning buffer.
 *
 * Default buffer: 10% of total duration OR 5 business days, whichever is greater.
 * Callers can override via `options.bufferDays` to provide a custom buffer.
 */
export function computeHealthStatus(
  deadline: Deadline,
  options: { now?: Date; bufferDays?: number } = {},
): HealthStatus {
  const now = options.now ?? new Date();
  const { bufferDays } = options;

  // If a health override is active, it takes precedence
  if (deadline.overrideActive) {
    return deadline.effectiveStatus;
  }

  // Hard "missed": due date has passed and we're not completed
  if (now > deadline.dueDate && !deadline.completed) {
    return 'missed';
  }

  // Default: on_track until we have reason otherwise
  let status: HealthStatus = 'on_track';

  // Compute the warning buffer
  const warnDays =
    bufferDays ??
    computeDefaultBuffer(deadline.createdAt, deadline.dueDate);

  const warnDate = new Date(deadline.dueDate.getTime() - warnDays * 86_400_000);

  // If we are past the warn date with no forecast or a forecast past due
  if (now >= warnDate) {
    if (!deadline.forecastDate || deadline.forecastDate > deadline.dueDate) {
      status = 'at_risk';
    } else {
      status = 'on_track';
    }
  }

  // If forecast exceeds due date, it's off track (unless already missed)
  if (deadline.forecastDate && deadline.forecastDate > deadline.dueDate) {
    status = 'off_track';
  }

  return status;
}

/**
 * Default buffer: 10% of total duration, minimum 5 business days.
 */
function computeDefaultBuffer(createdAt: Date, dueDate: Date): number {
  const durationDays =
    (dueDate.getTime() - createdAt.getTime()) / (86_400_000);
  const pctBuffer = Math.ceil(durationDays * 0.1);
  return Math.max(pctBuffer, 5);
}

/**
 * Recompute the health status for every deadline in an array and return the
 * updated list. Callers are expected to persist the updates themselves.
 */
export async function recomputeHealthForAll(
  deadlines: Deadline[],
  options?: { now?: Date; bufferDays?: number },
): Promise<Map<number, HealthStatus>> {
  const results = new Map<number, HealthStatus>();

  for (const dl of deadlines) {
    const status = computeHealthStatus(dl, options);
    if (status !== dl.healthStatus) {
      results.set(dl.id, status);
    }
  }

  return results;
}
