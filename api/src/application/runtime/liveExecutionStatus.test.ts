import { describe, expect, it } from 'vitest';
import { ExecutionStatus } from '../../domain/shared/types';
import { findLiveExecution, isLiveExecutionStatus, LIVE_EXECUTION_STATUSES } from './liveExecutionStatus';

describe('liveExecutionStatus', () => {
  it('treats pending, submitted, running and paused as live', () => {
    for (const s of [ExecutionStatus.PENDING, ExecutionStatus.SUBMITTED, ExecutionStatus.RUNNING, ExecutionStatus.PAUSED]) {
      expect(isLiveExecutionStatus(s)).toBe(true);
    }
    expect(LIVE_EXECUTION_STATUSES).toHaveLength(4);
  });

  it('treats terminal statuses as not live', () => {
    for (const s of [ExecutionStatus.COMPLETED, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED]) {
      expect(isLiveExecutionStatus(s)).toBe(false);
    }
  });

  it('finds the first live row of a newest-first list, reduced to id + status', () => {
    const rows = [
      { id: 9, status: 'failed', extra: 1 },
      { id: 8, status: 'running', extra: 2 },
      { id: 7, status: 'pending', extra: 3 },
    ];
    expect(findLiveExecution(rows)).toEqual({ id: 8, status: 'running' });
  });

  it('returns null when nothing is live', () => {
    expect(findLiveExecution([{ id: 1, status: 'completed' }])).toBeNull();
    expect(findLiveExecution([])).toBeNull();
  });
});
