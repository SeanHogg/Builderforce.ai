/**
 * Which runs get the early draft PR: only one whose branch CI is its only build.
 */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ ports: vi.fn((..._a: unknown[]) => ({ tag: 'ports' })) }));
vi.mock('../../ci/draftPrPorts', () => ({ draftPrPorts: h.ports }));
vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent: vi.fn() }));

import { earlyDraftPrFor } from './earlyDraftPr';

const base = {
  db: {} as never, run: { tenantId: 1, projectId: 2, taskId: 3, executionId: 9, agentLabel: 'A' },
  repoCtx: { branch: 'bf/task-3' } as never, hasSandbox: false, delegated: false,
};

describe('earlyDraftPrFor', () => {
  it('gives a sandbox-less, non-delegated, repo-bound run the ports', () => {
    expect(earlyDraftPrFor(base)).toEqual({ ports: { tag: 'ports' } });
    expect(h.ports).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 1, task: { id: 3, title: '#3' }, agentLabel: 'A' }));
  });
  it('gives a run with a sandbox nothing', () => {
    expect(earlyDraftPrFor({ ...base, hasSandbox: true })).toBeUndefined();
  });
  it('gives a delegated child nothing (its owner owns the task\'s single PR)', () => {
    expect(earlyDraftPrFor({ ...base, delegated: true })).toBeUndefined();
  });
  it('gives a run with no repository nothing', () => {
    expect(earlyDraftPrFor({ ...base, repoCtx: null })).toBeUndefined();
  });
});
