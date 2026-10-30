import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunOutcomeRow } from '@builderforce/agent-run';

/**
 * The canvas host posts a run's uniform outcome row through the typed API client — once,
 * `entryPoint: 'canvas'`, never as a routing signal — and treats it as ambient telemetry:
 * skipped (a non-error trace line) for a guest board, a missing session, or Local only.
 */

const mocks = vi.hoisted(() => ({
  reportRunOutcome: vi.fn(async (_body: unknown) => ({ ok: true })),
  token: vi.fn((): string | null => 'tenant-jwt'),
  mode: vi.fn((): string => 'hybrid'),
}));

vi.mock('@/lib/learnedRoutingApi', () => ({ learnedRoutingApi: { reportRunOutcome: mocks.reportRunOutcome } }));
vi.mock('@/lib/auth', () => ({ getStoredTenantToken: () => mocks.token() }));
vi.mock('@/lib/localFirst/webInferenceMode', () => ({ webInferenceModeNow: () => mocks.mode() }));

const { canvasOutcomeReporter } = await import('./canvasOutcomeReporter');

const ROW: RunOutcomeRow = {
  entryPoint: 'canvas', model: 'known/model', steps: 2, toolCalls: 1, toolErrors: 0, compactions: 0,
  stallRecoveries: 0, escalations: 0, verify: 'not-run', terminalStatus: 'finished',
};

function reporter(over: { persistence?: 'local' | 'server'; signal?: AbortSignal } = {}) {
  const trace = vi.fn();
  const report = canvasOutcomeReporter({
    persistence: over.persistence ?? 'server', requestMessageId: 'msg-1', runKey: 'brain', projectId: 12,
    signal: over.signal ?? new AbortController().signal, trace,
  });
  return { report, trace };
}

beforeEach(() => {
  mocks.reportRunOutcome.mockReset().mockResolvedValue({ ok: true });
  mocks.token.mockReturnValue('tenant-jwt');
  mocks.mode.mockReturnValue('hybrid');
});

describe('canvasOutcomeReporter', () => {
  it('posts one canvas row through the typed client, never as a routing signal', () => {
    const { report } = reporter();

    report(ROW);

    expect(mocks.reportRunOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.reportRunOutcome.mock.calls[0]?.[0]).toMatchObject({
      entryPoint: 'canvas', model: 'known/model', terminalStatus: 'completed', routingSignal: false, projectId: 12, toolCalls: 1,
    });
    expect((mocks.reportRunOutcome.mock.calls[0]?.[0] as { clientRunId: string }).clientRunId).toBe('canvas:msg-1:brain');
  });

  it('reports the same run under the same id, so a retried report is idempotent', () => {
    const { report } = reporter();

    report(ROW);
    report(ROW);

    const ids = mocks.reportRunOutcome.mock.calls.map((call) => (call[0] as { clientRunId: string }).clientRunId);
    expect(ids[1]).toBe(ids[0]);
  });

  it('reports a stopped run as cancelled', () => {
    const stopped = new AbortController();
    stopped.abort();

    reporter({ signal: stopped.signal }).report(ROW);

    expect(mocks.reportRunOutcome.mock.calls[0]?.[0]).toMatchObject({ terminalStatus: 'cancelled' });
  });

  it("carries the row's quota-exhausted flag (set once by the row builder), and says nothing otherwise", () => {
    reporter().report({ ...ROW, terminalStatus: 'failed', quotaExhausted: true });
    reporter().report({ ...ROW, terminalStatus: 'failed' });

    expect(mocks.reportRunOutcome.mock.calls[0]?.[0]).toMatchObject({ quotaExhausted: true });
    expect(mocks.reportRunOutcome.mock.calls[1]?.[0]).not.toHaveProperty('quotaExhausted');
  });

  it.each([
    ['a guest board', () => reporter({ persistence: 'local' })],
    ['no signed-in session', () => { mocks.token.mockReturnValue(null); return reporter(); }],
    ['Local only inference', () => { mocks.mode.mockReturnValue('local-only'); return reporter(); }],
  ])('sends nothing for %s, and says so as a non-error trace line', (_name, setup) => {
    const { report, trace } = setup();

    report(ROW);

    expect(mocks.reportRunOutcome).not.toHaveBeenCalled();
    expect(trace).toHaveBeenCalledWith(expect.objectContaining({ label: 'run outcome not reported', category: 'message' }));
    expect(trace.mock.calls[0]?.[0]).not.toHaveProperty('isError');
  });

  it('a send that fails is a trace line, not a thrown error', async () => {
    mocks.reportRunOutcome.mockRejectedValue(new Error('gateway down'));
    const { report, trace } = reporter();

    report(ROW);

    await vi.waitFor(() => expect(trace).toHaveBeenCalledWith(expect.objectContaining({ result: 'gateway down', category: 'message' })));
  });
});
