/**
 * MK-09-W5 — an empty-diff finalize is not a completed delivery.
 *
 * The PR is already skipped when nothing was written. This is the status half:
 * not cancelled and nothing written → `no_changes`, never `completed`.
 */
import { ExecutionStatus } from '../../domain/shared/types';

export function emptyDiffTerminalStatus(args: {
  writtenCount: number;
  cancelled: boolean;
}): ExecutionStatus.NO_CHANGES | null {
  if (args.cancelled || args.writtenCount > 0) return null;
  return ExecutionStatus.NO_CHANGES;
}
