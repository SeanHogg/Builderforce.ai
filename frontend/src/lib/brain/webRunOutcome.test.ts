import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ token: 'tok' as string | null, mode: 'hybrid' as string, report: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/auth', () => ({ getStoredTenantToken: () => mocks.token }));
vi.mock('@/lib/localFirst/webInferenceMode', () => ({ webInferenceModeNow: () => mocks.mode }));
vi.mock('@/lib/learnedRoutingApi', () => ({ learnedRoutingApi: { reportRunOutcome: mocks.report } }));

const { reportWebRunOutcome } = await import('./webRunOutcome');

const record = { clientRunId: 'r1', model: 'm', source: 'external', entryPoint: 'web', terminalStatus: 'completed', routingSignal: false } as never;

beforeEach(() => { mocks.token = 'tok'; mocks.mode = 'hybrid'; mocks.report.mockClear(); });

describe('the web Brain report port', () => {
  it('sends the record once, as it is, to the one door', async () => {
    await reportWebRunOutcome(record);
    expect(mocks.report).toHaveBeenCalledTimes(1);
    expect(mocks.report).toHaveBeenCalledWith(record);
  });

  it('lets a failed send reject to the run store, which records it, rather than swallowing it', async () => {
    mocks.report.mockRejectedValueOnce(new Error('door unreachable'));
    await expect(reportWebRunOutcome(record)).rejects.toThrow('door unreachable');
  });

  it('sends nothing without a signed-in tenant session, or when inference is Local only', async () => {
    mocks.token = null;
    await reportWebRunOutcome(record);
    mocks.token = 'tok';
    mocks.mode = 'local-only';
    await reportWebRunOutcome(record);
    expect(mocks.report).not.toHaveBeenCalled();
  });
});
