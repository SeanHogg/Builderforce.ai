import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ token: null as string | null }));
const transport = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('./auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./auth')>(),
  getStoredTenantToken: () => state.token,
}));
vi.mock('./apiClient', () => ({
  apiRequest: transport.request,
  apiRequestStream: vi.fn(),
  apiRequestText: vi.fn(),
}));

import { embedApi } from './builderforceApi';

describe('embedApi authentication boundary', () => {
  beforeEach(() => {
    state.token = null;
    transport.request.mockReset();
    transport.request.mockResolvedValue({ enabled: false });
  });

  it('does not emit a network request without a workspace token', async () => {
    await expect(embedApi.getConfig()).rejects.toThrow('Workspace token required');
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('uses the shared authenticated transport once a workspace token exists', async () => {
    state.token = 'tenant-jwt';
    await embedApi.getConfig();
    expect(transport.request).toHaveBeenCalledWith('/api/embed/config', {});
  });
});
