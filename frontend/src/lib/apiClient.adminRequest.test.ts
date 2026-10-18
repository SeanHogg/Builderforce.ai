// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./auth', () => ({
  AUTH_API_URL: 'https://api.builderforce.test',
  checkUnauthorizedAndRedirect: vi.fn(),
  getStoredTenantToken: vi.fn(() => 'tenant-token'),
  getStoredWebToken: vi.fn(() => null),
}));

vi.mock('@/i18n/config', () => ({
  LOCALE_HEADER: 'X-BuilderForce-Locale',
  readLocaleCookie: vi.fn(() => 'en'),
}));

import { adminRequest } from './apiClient';
import { getStoredWebToken } from './auth';

describe('adminRequest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws the superadmin sign-in message without a web token, before any fetch', async () => {
    vi.mocked(getStoredWebToken).mockReturnValue(null);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(adminRequest('/api/admin/x')).rejects.toThrow('Not authenticated. Sign in with a superadmin account.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the web token, not the tenant token', async () => {
    vi.mocked(getStoredWebToken).mockReturnValue('web-token');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(adminRequest('/api/admin/x')).resolves.toEqual({ ok: true });
    const headers = new Headers((fetchSpy.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer web-token');
  });
});
