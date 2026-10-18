import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionStatus } from '../../domain/shared/types';

const mocks = vi.hoisted(() => ({ settleLateSteersSafely: vi.fn(async () => ({ kind: 'none' })), notify: vi.fn() }));
vi.mock('./lateSteerFollowUp', () => ({ settleLateSteersSafely: mocks.settleLateSteersSafely }));
vi.mock('./executionEvents', () => ({ notifyExecutionSubscribers: mocks.notify }));

import { extractCodeChangesFromResult, normalizeCodeChanges, reportExecutionState } from './reportExecutionState';

function exec(status: ExecutionStatus, terminal = false) {
  return { id: 5, status, isTerminal: terminal, submittedBy: 'u-owner', toPlain: () => ({ id: 5, status }) };
}

function harness(current: ReturnType<typeof exec>) {
  const runtimeService = {
    getExecution: vi.fn(async () => current),
    update: vi.fn(async (_id: number, dto: { status: ExecutionStatus }) => exec(dto.status, dto.status !== ExecutionStatus.RUNNING)),
    cancel: vi.fn(async () => exec(ExecutionStatus.CANCELLED, true)),
  };
  const waitUntil = vi.fn();
  // No code changes are reported in these cases, so the insight query never runs.
  const deps = { env: {} as never, db: {} as never, runtimeService: runtimeService as never, waitUntil };
  return { runtimeService, waitUntil, deps };
}

beforeEach(() => { mocks.settleLateSteersSafely.mockClear(); mocks.notify.mockClear(); });

describe('reportExecutionState — the one execution-state use case', () => {
  it('runs a non-terminal report through the domain transition and streams it', async () => {
    const h = harness(exec(ExecutionStatus.SUBMITTED));
    await reportExecutionState(h.deps, { executionId: 5, tenantId: 1, status: ExecutionStatus.RUNNING });
    expect(h.runtimeService.update).toHaveBeenCalledWith(5, { status: ExecutionStatus.RUNNING });
    expect(mocks.notify).toHaveBeenCalledWith(5, expect.objectContaining({ type: 'status_change' }));
    expect(h.waitUntil).not.toHaveBeenCalled();
  });

  it('settles late steers and announces done on a terminal report', async () => {
    const h = harness(exec(ExecutionStatus.RUNNING));
    await reportExecutionState(h.deps, { executionId: 5, tenantId: 1, status: ExecutionStatus.FAILED, errorMessage: 'boom' });
    expect(h.runtimeService.update).toHaveBeenCalledWith(5, { status: ExecutionStatus.FAILED, errorMessage: 'boom' });
    expect(h.waitUntil).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith(5, expect.objectContaining({ type: 'done' }));
  });

  it('turns an executor-reported cancel into a domain cancel attributed to the submitter', async () => {
    const h = harness(exec(ExecutionStatus.RUNNING));
    await reportExecutionState(h.deps, { executionId: 5, tenantId: 1, status: ExecutionStatus.CANCELLED });
    expect(h.runtimeService.cancel).toHaveBeenCalledWith(5, 'u-owner');
  });

  // Regression: the host door wrote the row directly, so a late "completed" from a
  // host resurrected a run the platform had already cancelled.
  it('acknowledges a late report on a terminal run without changing it (host door)', async () => {
    const h = harness(exec(ExecutionStatus.CANCELLED, true));
    const out = await reportExecutionState({ ...h.deps, tolerateLate: true }, { executionId: 5, tenantId: 1, status: ExecutionStatus.COMPLETED });
    expect(out.status).toBe(ExecutionStatus.CANCELLED);
    expect(h.runtimeService.update).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

describe('code-change extraction', () => {
  it('accepts a numeric string from older hosts and clamps negatives', () => {
    expect(normalizeCodeChanges('12')).toBe(12);
    expect(normalizeCodeChanges(-3)).toBe(0);
    expect(normalizeCodeChanges('x')).toBeNull();
  });

  it('finds a count nested anywhere in a JSON result, or sums insertions and deletions', () => {
    expect(extractCodeChangesFromResult(JSON.stringify({ summary: { linesChanged: 40 } }))).toBe(40);
    expect(extractCodeChangesFromResult(JSON.stringify([{ additions: 3, deletions: 2 }]))).toBe(5);
    expect(extractCodeChangesFromResult('not json')).toBeNull();
  });
});
