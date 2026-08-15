// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStoredTenantToken: vi.fn<() => string | null>(),
  models: vi.fn(),
  tenantModels: vi.fn(),
}));

vi.mock('./auth', () => ({ getStoredTenantToken: mocks.getStoredTenantToken }));
vi.mock('./builderforceApi', () => ({
  llmApi: { models: mocks.models },
  tenantModelApi: { list: mocks.tenantModels },
}));
vi.mock('./modelCatalog', () => ({ getPremiumModelCatalog: vi.fn(async () => []) }));

import { invalidateLlmModels, useLlmModels } from './useLlmModels';

describe('useLlmModels guest loading', () => {
  beforeEach(() => {
    invalidateLlmModels();
    mocks.getStoredTenantToken.mockReset();
    mocks.models.mockReset();
    mocks.tenantModels.mockReset();
  });

  it('does not call tenant-scoped model endpoints without a workspace token', async () => {
    mocks.getStoredTenantToken.mockReturnValue(null);

    const { result } = renderHook(() => useLlmModels());
    await waitFor(() => expect(mocks.getStoredTenantToken).toHaveBeenCalled());

    expect(result.current.models).toEqual([]);
    expect(mocks.models).not.toHaveBeenCalled();
    expect(mocks.tenantModels).not.toHaveBeenCalled();
  });

  it('loads both model surfaces for an authenticated workspace', async () => {
    mocks.getStoredTenantToken.mockReturnValue('tenant-token');
    mocks.models.mockResolvedValue({
      configured: false,
      product: 'BuilderForce',
      effectivePlan: 'free',
      models: ['minimax/minimax-m2.5:free'],
    });
    mocks.tenantModels.mockResolvedValue({ models: [] });

    const { result } = renderHook(() => useLlmModels());
    await waitFor(() => expect(result.current.models).toEqual(['minimax/minimax-m2.5:free']));

    expect(mocks.models).toHaveBeenCalledOnce();
    expect(mocks.tenantModels).toHaveBeenCalledOnce();
  });
});
