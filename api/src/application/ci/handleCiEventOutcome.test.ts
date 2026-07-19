/**
 * handleCiEventOutcome — the provider-independent post-ingest half. `ingestRepoCiEvent`
 * is mocked so these assert the HANDLER's contract (dispatch, loop-guard telemetry,
 * observable skip) rather than re-testing the decision logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IngestResult, RepoCiEvent } from './ingestRepoCiEvent';

const ingestMock = vi.fn<(...a: unknown[]) => Promise<IngestResult>>();
vi.mock('./ingestRepoCiEvent', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ingestRepoCiEvent: (...a: unknown[]) => ingestMock(...a),
}));

const { handleCiEventOutcome, AUTOFIX_SKIPPED_EVENT } = await import('./handleCiEventOutcome');
const { AUTOFIX_DISPATCH_EVENT } = await import('./ingestRepoCiEvent');

const EVT: RepoCiEvent = {
  eventType: 'pipeline', branch: 'builderforce/task-7', sha: 'abc',
  outcome: 'failure', rawState: 'failed', targetUrl: 'http://ci/1', runId: 1,
};

function makeDeps(dispatchResult: number | null = 55) {
  const inserts: Array<Record<string, unknown>> = [];
  const pending: Array<Promise<unknown>> = [];
  const dispatchRun = vi.fn(async () => dispatchResult);
  const deps = {
    db: { insert: () => ({ values: (v: Record<string, unknown>) => { inserts.push(v); return Promise.resolve([]); } }) },
    env: { JWT_SECRET: 's' },
    dispatchRun,
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { deps: deps as any, inserts, dispatchRun, settle: () => Promise.all(pending) };
}

beforeEach(() => { ingestMock.mockReset(); });

describe('handleCiEventOutcome', () => {
  it('dispatches the auto-fix intent and records the loop-guard event', async () => {
    ingestMock.mockResolvedValue({
      processed: true, taskId: 7, tenantId: 3, executionId: 9, buildStatus: 'failure',
      autoFix: { taskId: 7, tenantId: 3, attempt: 2, payload: '{"remediation":{}}' },
    });
    const { deps, inserts, dispatchRun, settle } = makeDeps();

    const res = await handleCiEventOutcome(deps, EVT, 'gitlab');
    expect(res.autoFixDispatched).toBe(true);
    await settle();

    expect(dispatchRun).toHaveBeenCalledWith({ taskId: 7, tenantId: 3, payload: '{"remediation":{}}', submittedBy: 'system:autofix' });
    const ev = inserts.find((i) => i.toolName === AUTOFIX_DISPATCH_EVENT);
    expect(ev).toBeTruthy();
    expect(ev?.executionId).toBe(55);
    expect(ev?.tenantId).toBe(3);
    expect(String(ev?.args)).toContain('"source":"gitlab"');
  });

  it('records no loop-guard event when the dispatch yields no execution', async () => {
    ingestMock.mockResolvedValue({
      processed: true, taskId: 7, tenantId: 3, buildStatus: 'failure',
      autoFix: { taskId: 7, tenantId: 3, attempt: 1, payload: '{}' },
    });
    const { deps, inserts, settle } = makeDeps(null);
    await handleCiEventOutcome(deps, EVT, 'bitbucket');
    await settle();
    expect(inserts.find((i) => i.toolName === AUTOFIX_DISPATCH_EVENT)).toBeUndefined();
  });

  it('a webhook stays 200 when the dispatch throws', async () => {
    ingestMock.mockResolvedValue({
      processed: true, taskId: 7, tenantId: 3, buildStatus: 'failure',
      autoFix: { taskId: 7, tenantId: 3, attempt: 1, payload: '{}' },
    });
    const { deps, settle } = makeDeps();
    deps.dispatchRun = vi.fn(async () => { throw new Error('boom'); });
    const res = await handleCiEventOutcome(deps, EVT, 'github');
    expect(res.autoFixDispatched).toBe(true);
    await expect(settle()).resolves.toBeDefined();
  });

  it('emits an observable event when a FAILURE produced no fix run', async () => {
    ingestMock.mockResolvedValue({
      processed: true, taskId: 7, tenantId: 3, executionId: 9,
      buildStatus: 'failure', reason: 'event not auto-fix eligible',
    });
    const { deps, inserts } = makeDeps();
    const res = await handleCiEventOutcome(deps, EVT, 'bitbucket');
    expect(res.autoFixDispatched).toBe(false);
    const ev = inserts.find((i) => i.toolName === AUTOFIX_SKIPPED_EVENT);
    expect(ev).toBeTruthy();
    expect(ev?.tenantId).toBe(3);
    expect(String(ev?.result)).toContain('event not auto-fix eligible');
  });

  it('does not double-report the exhaustion case (build.needs_human already fired)', async () => {
    ingestMock.mockResolvedValue({
      processed: true, taskId: 7, tenantId: 3, buildStatus: 'failure', reason: 'auto-fix attempts exhausted',
    });
    const { deps, inserts } = makeDeps();
    await handleCiEventOutcome(deps, EVT, 'github');
    expect(inserts.find((i) => i.toolName === AUTOFIX_SKIPPED_EVENT)).toBeUndefined();
  });

  it('a green build emits nothing extra', async () => {
    ingestMock.mockResolvedValue({ processed: true, taskId: 7, tenantId: 3, buildStatus: 'success', merged: true });
    const { deps, inserts, dispatchRun } = makeDeps();
    const res = await handleCiEventOutcome(deps, { ...EVT, outcome: 'success' }, 'gitlab');
    expect(res.merged).toBe(true);
    expect(dispatchRun).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });
});
