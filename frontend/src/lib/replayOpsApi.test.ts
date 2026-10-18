import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPLAY_PATHS } from '@builderforce/interaction-contract';

/** The operator client: every path from `REPLAY_PATHS`, every call web-authenticated. */

const transport = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('./apiClient', () => ({
  adminRequest: (path: string, init: object = {}) => transport.apiRequest(path, { ...init, auth: 'web' }),
}));

import { replayOpsApi } from './replayOpsApi';

afterEach(() => {
  transport.apiRequest.mockReset();
});

describe('replayOpsApi', () => {
  it('reads and patches a workspace\'s settings at the contract path', async () => {
    transport.apiRequest.mockResolvedValue({ replayExcluded: true, replayFreeAllowanceOverride: null });
    await replayOpsApi.tenantSettings(7);
    expect(transport.apiRequest).toHaveBeenLastCalledWith('/api/admin/replay-ops/tenants/7/settings', { auth: 'web' });

    await replayOpsApi.updateTenantSettings(7, { replayExcluded: true });
    expect(transport.apiRequest).toHaveBeenLastCalledWith('/api/admin/replay-ops/tenants/7/settings', {
      method: 'PATCH',
      body: JSON.stringify({ replayExcluded: true }),
      auth: 'web',
    });
  });

  it('posts a grant to REPLAY_PATHS.opsGrants', async () => {
    transport.apiRequest.mockResolvedValue({ auditId: 'a', reference: 'replay-grant:a', units: 5, credits: 5 });
    const input = { tenantId: 7, units: 5, reason: 'design partner' };
    await replayOpsApi.grantCredits(input);
    expect(transport.apiRequest).toHaveBeenLastCalledWith(REPLAY_PATHS.opsGrants, {
      method: 'POST',
      body: JSON.stringify(input),
      auth: 'web',
    });
  });

  it('fills the seed path with the site id', async () => {
    transport.apiRequest.mockResolvedValue({});
    await replayOpsApi.seedMethodFunnel('site-1');
    expect(transport.apiRequest).toHaveBeenLastCalledWith('/api/admin/replay-ops/sites/site-1/seed-method-funnel', {
      method: 'POST',
      auth: 'web',
    });
  });
});
