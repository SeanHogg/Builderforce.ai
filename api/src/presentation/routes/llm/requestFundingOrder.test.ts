import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAccountBrainPreferences = vi.fn();
vi.mock('../../../application/brain/accountBrainPreferences', () => ({
  getAccountBrainPreferences: (...args: unknown[]) => getAccountBrainPreferences(...args),
}));
vi.mock('../../../application/shared/dbHandle', () => ({ requestDb: () => ({}) }));
vi.mock('../../../application/observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { requestFundingOrder } from './requestFundingOrder';
import type { RequestDbContext } from '../../../application/shared/dbHandle';

// The ONE request-side read of the funding order, shared by /v1/chat/completions and
// /v1/messages: the account preference only when the turn did not choose, never fatal.

const c = { env: {} } as unknown as RequestDbContext;
const access = { tenantId: 7, userId: 'u-1' } as never;
const source = 'test';

beforeEach(() => { getAccountBrainPreferences.mockReset(); });

describe('requestFundingOrder', () => {
  it('applies the account cloudOrder when the turn did not choose', async () => {
    getAccountBrainPreferences.mockResolvedValue({ cloudOrder: 'free_first' });
    expect(await requestFundingOrder(c, access, { byoConfigured: true, source })).toEqual({ allowGatewayAuto: true, freeFirst: true });
  });

  it('an explicit routingMode wins and the preference is never read', async () => {
    expect(await requestFundingOrder(c, access, { requested: 'byo_pool', byoConfigured: true, source })).toEqual({ byoRequired: true });
    expect(getAccountBrainPreferences).not.toHaveBeenCalled();
  });

  it('a failed preference read falls back to the inference', async () => {
    getAccountBrainPreferences.mockRejectedValue(new Error('db down'));
    expect(await requestFundingOrder(c, access, { byoConfigured: true, source })).toEqual({ allowGatewayAuto: true });
  });

  it('no person behind the call: inferred, no read', async () => {
    expect(await requestFundingOrder(c, { tenantId: 7, userId: null } as never, { byoConfigured: false, source })).toEqual({});
    expect(getAccountBrainPreferences).not.toHaveBeenCalled();
  });
});
