/**
 * The host door for tenant-level governance gates: it needs a host key, answers with
 * the compiled wire shape the runner's `coercePolicyGates` reads, and reaches the
 * cached resolver for the AUTHENTICATED host's tenant only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PolicyGate } from '@builderforce/agent-tools';

const mocks = vi.hoisted(() => ({ hostAuth: vi.fn(), resolve: vi.fn() }));

vi.mock('../../infrastructure/auth/agentHostAuth', () => ({ resolveHostAuth: mocks.hostAuth }));
vi.mock('../../infrastructure/auth/segmentResolver', () => ({ resolveSegment: async () => 'seg-1' }));
vi.mock('../../application/governance/policyPackService', () => ({ resolvePolicyGates: mocks.resolve }));

import { createAgentGovernanceRoutes } from './agentGovernanceRoutes';

const db = {} as never;
const env = { marker: 'env' };
const gates: PolicyGate[] = [
  { id: 'no-shell', tool: 'exec', effect: 'block', reason: 'shell is off for this tenant' },
  { id: 'be-careful', effect: 'inject-directive', directive: 'Never touch production.' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hostAuth.mockResolvedValue({ id: 3, tenantId: 8 });
  mocks.resolve.mockResolvedValue(gates);
});

describe('GET /policy-gates (agent-host door)', () => {
  it('requires a host key', async () => {
    mocks.hostAuth.mockResolvedValue(null);
    const res = await createAgentGovernanceRoutes(db).request('/policy-gates', {}, env);
    expect(res.status).toBe(401);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('returns the compiled gates for the host tenant, at tenant-only scope', async () => {
    const res = await createAgentGovernanceRoutes(db).request('/policy-gates', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gates });
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).toHaveBeenCalledWith(env, db, { tenantId: 8 });
  });

  it('takes the tenant from the key, never from the request', async () => {
    await createAgentGovernanceRoutes(db).request('/policy-gates?tenantId=99&project=5&agent=other', {}, env);
    expect(mocks.resolve).toHaveBeenCalledWith(env, db, { tenantId: 8 });

    mocks.hostAuth.mockResolvedValue({ id: 4, tenantId: 21 });
    await createAgentGovernanceRoutes(db).request('/policy-gates', {}, env);
    expect(mocks.resolve).toHaveBeenLastCalledWith(env, db, { tenantId: 21 });
  });

  it('answers an empty list for a tenant with no packs', async () => {
    mocks.resolve.mockResolvedValue([]);
    const res = await createAgentGovernanceRoutes(db).request('/policy-gates', {}, env);
    expect(await res.json()).toEqual({ gates: [] });
  });
});
