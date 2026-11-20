import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ report: vi.fn(), cloud: vi.fn() }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: h.report }));
vi.mock('./managerPolicyStore', () => ({ getCloudShipPolicy: h.cloud }));

import { runShipPayloadForTask } from './taskShipPolicy';

const dbReturning = (rows: unknown[] | Error) => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => { if (rows instanceof Error) throw rows; return rows; } }) }) }),
}) as never;

describe('runShipPayloadForTask — the agent-host ship payload never fails the dispatch', () => {
  it('a failed task read is reported and falls back to the built-in policy (a PR nothing merges)', async () => {
    const out = await runShipPayloadForTask(dbReturning(new Error('neon down')), 1, 7);
    expect(h.report).toHaveBeenCalledOnce();
    expect(out?.shipPolicy).toEqual({ mode: 'pull_request', merge: 'never', review: 'none', source: 'project_settings' });
    expect(out?.shipDirective).toContain('the platform opens the pull request');
    expect(h.cloud).not.toHaveBeenCalled();
  });

  it('reads the project\'s cloud policy and words it for a host whose platform opens the PR', async () => {
    h.cloud.mockResolvedValue({ mode: 'pull_request', merge: 'on_green', review: 'none', source: 'project_settings' });
    const out = await runShipPayloadForTask(dbReturning([{ projectId: 3 }]), 1, 7);
    expect(h.cloud).toHaveBeenCalledWith(expect.anything(), 1, 3, undefined);
    expect(out?.shipDirective).toContain('merges it once CI is green');
    expect(out?.shipDirective).not.toContain('open_pull_request');
  });

  it('is null for a task outside the tenant', async () => {
    expect(await runShipPayloadForTask(dbReturning([]), 1, 7)).toBeNull();
  });
});
