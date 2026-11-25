import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableError, UnauthorizedError } from '../../domain/shared/errors';

const { auth, hostCaller } = vi.hoisted(() => ({ auth: vi.fn(), hostCaller: vi.fn() }));
vi.mock('./authMiddleware', () => ({ authMiddleware: auth }));
vi.mock('../../application/auth/callerTenant', () => ({ resolveAgentHostCaller: hostCaller }));

import { resolveCallerTenant } from './callerTenant';

const ctx = (tenantId?: number) => ({ get: (k: string) => (k === 'tenantId' ? tenantId : undefined) }) as never;

describe('resolveCallerTenant', () => {
  beforeEach(() => { auth.mockReset(); hostCaller.mockReset(); hostCaller.mockResolvedValue(null); });

  it('returns null for a missing/invalid token (UnauthorizedError)', async () => {
    auth.mockRejectedValue(new UnauthorizedError('Invalid or expired token'));
    await expect(resolveCallerTenant({} as never, ctx())).resolves.toBeNull();
  });

  it('regression: a database outage is rethrown, not read as "no credential"', async () => {
    const outage = new ServiceUnavailableError('down', { code: 'database_unavailable' });
    auth.mockRejectedValue(outage);
    await expect(resolveCallerTenant({} as never, ctx())).rejects.toBe(outage);
  });

  it('resolves the tenant from the JWT when authMiddleware succeeds', async () => {
    auth.mockResolvedValue(undefined);
    await expect(resolveCallerTenant({} as never, ctx(7))).resolves.toEqual({ tenantId: 7, agentHostId: null });
  });
});
