import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeSecurityApi } from './runtimeSecurityApi';
import { clearWorkerPolicies, prepareWorkerPolicy, WORKER_POLICY_RENEW_MS, workerPolicyFor } from './previewWorkerPolicies';

vi.mock('./runtimeSecurityApi', () => ({ runtimeSecurityApi: { mintWorkerPolicy: vi.fn() } }));
vi.mock('@/lib/reportError', () => ({ recordedFailure: () => () => undefined }));

const mint = vi.mocked(runtimeSecurityApi.mintWorkerPolicy);
const APP = 'app:42:0123456789abcdef';
const KEY = '96c02ff6106da114d069c7a8eff3c26a';
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

beforeEach(() => {
  clearWorkerPolicies();
  mint.mockReset();
});

describe('worker policies', () => {
  it('mints once, then answers synchronously from the cache', async () => {
    mint.mockResolvedValue({ policy: 'p.sig', expiresAt: inAnHour(), originKey: KEY });
    expect(workerPolicyFor(APP)).toBeUndefined();
    await prepareWorkerPolicy('42', APP, KEY);
    await prepareWorkerPolicy('42', APP, KEY);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledWith(42, APP);
    expect(workerPolicyFor(APP)).toBe('p.sig');
  });

  it('re-mints a policy close to expiry, and never serves one past it', async () => {
    const soon = new Date(Date.now() + WORKER_POLICY_RENEW_MS - 1_000).toISOString();
    mint.mockResolvedValueOnce({ policy: 'old', expiresAt: soon, originKey: KEY });
    await prepareWorkerPolicy('42', APP, KEY);
    expect(workerPolicyFor(APP)).toBeUndefined();
    mint.mockResolvedValueOnce({ policy: 'new', expiresAt: inAnHour(), originKey: KEY });
    await prepareWorkerPolicy('42', APP, KEY);
    expect(workerPolicyFor(APP)).toBe('new');
  });

  it('drops a policy bound to another origin than the one the runtime will open', async () => {
    mint.mockResolvedValue({ policy: 'p.sig', expiresAt: inAnHour(), originKey: 'f'.repeat(32) });
    await prepareWorkerPolicy('42', APP, KEY);
    expect(workerPolicyFor(APP)).toBeUndefined();
  });

  it('re-mints when the runtime will open the application on another origin', async () => {
    mint.mockResolvedValueOnce({ policy: 'first', expiresAt: inAnHour(), originKey: KEY });
    await prepareWorkerPolicy('42', APP, KEY);
    const other = 'a'.repeat(32);
    mint.mockResolvedValueOnce({ policy: 'second', expiresAt: inAnHour(), originKey: other });
    await prepareWorkerPolicy('42', APP, other);
    expect(mint).toHaveBeenCalledTimes(2);
    expect(workerPolicyFor(APP)).toBe('second');
  });

  it('starts with no policy (the most restrictive) when minting fails, without throwing', async () => {
    mint.mockRejectedValue(new Error('offline'));
    await expect(prepareWorkerPolicy('42', APP, KEY)).resolves.toBeUndefined();
    expect(workerPolicyFor(APP)).toBeUndefined();
  });

  it('never mints for a project that is not a stored one', async () => {
    await prepareWorkerPolicy('local-abc', APP, KEY);
    expect(mint).not.toHaveBeenCalled();
  });
});
