import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_ERROR_EVENT } from './errors/apiErrorEvent';

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

import { apiRequest } from './apiClient';

describe('apiRequest expected errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws the server explanation without raising a global support error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'done_blocked',
      message: 'Cannot move to Done — outstanding required roles: QA Engineer',
      outstanding: ['QA Engineer'],
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }));
    const onGlobalError: EventListener = vi.fn();
    window.addEventListener(API_ERROR_EVENT, onGlobalError);

    await expect(apiRequest('/api/tasks/536', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
      expectedErrors: [409],
    })).rejects.toThrow('Cannot move to Done — outstanding required roles: QA Engineer');

    expect(onGlobalError).not.toHaveBeenCalled();
    window.removeEventListener(API_ERROR_EVENT, onGlobalError);
  });
});
