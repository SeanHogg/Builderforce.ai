// @vitest-environment jsdom
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

import { apiRequest, apiRequestStream } from './apiClient';
import { getStoredTenantToken } from './auth';
import { onTermsGate } from './errors/termsGateEvent';

/** What every auth middleware answers a request that sent no bearer token. */
function missingAuthHeaderResponse(): Response {
  return new Response(JSON.stringify({ error: 'Missing or malformed Authorization header' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The gate body the three auth middlewares return once terms move on. */
function termsGateResponse(): Response {
  return new Response(JSON.stringify({
    error: 'Terms acceptance required',
    code: 'TERMS_ACCEPTANCE_REQUIRED',
    requiredVersion: '2.0.0',
    acceptedVersion: '1.0.0',
  }), { status: 428, headers: { 'Content-Type': 'application/json' } });
}

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

describe('gate signals', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The terms bump: every in-flight request answers 428 while the acceptance
   *  screen is up, so reporting them buried that screen under support toasts. */
  it('routes a terms-acceptance gate to the onboarding gate, not the error surface', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(termsGateResponse());
    const onGlobalError: EventListener = vi.fn();
    const onGate = vi.fn();
    window.addEventListener(API_ERROR_EVENT, onGlobalError);
    const unsubscribe = onTermsGate(onGate);

    // Still throws — callers keep their own handling; only the toast is withheld.
    await expect(apiRequest('/api/messages/threads')).rejects.toThrow('Terms acceptance required');

    expect(onGlobalError).not.toHaveBeenCalled();
    expect(onGate).toHaveBeenCalledTimes(1);
    unsubscribe();
    window.removeEventListener(API_ERROR_EVENT, onGlobalError);
  });

  /** The streaming transport parses the envelope too — without the code it read
   *  the gate as a bare "Stream request failed" and toasted every poll. */
  it('recognises the gate on the streaming transport', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(termsGateResponse());
    const onGlobalError: EventListener = vi.fn();
    const onGate = vi.fn();
    window.addEventListener(API_ERROR_EVENT, onGlobalError);
    const unsubscribe = onTermsGate(onGate);

    // Does not throw — the caller inspects the status itself — and the body is
    // still readable, because the envelope was parsed from a clone.
    const res = await apiRequestStream('/api/activity/flush', { method: 'POST' });
    expect(res.status).toBe(428);
    await expect(res.json()).resolves.toMatchObject({ code: 'TERMS_ACCEPTANCE_REQUIRED' });

    expect(onGlobalError).not.toHaveBeenCalled();
    expect(onGate).toHaveBeenCalledTimes(1);
    unsubscribe();
    window.removeEventListener(API_ERROR_EVENT, onGlobalError);
  });

  /** A signed-out visitor is not a defect report.
   *
   *  Every connected-account panel on the creation canvas calls the API with the
   *  tenant token, so a guest tapping along the rail turned one 401 per panel
   *  into one support ticket per panel. */
  it('does not report a 401 on a request that carried no credential', async () => {
    vi.mocked(getStoredTenantToken).mockReturnValue(null);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(missingAuthHeaderResponse());
    const onGlobalError: EventListener = vi.fn();
    window.addEventListener(API_ERROR_EVENT, onGlobalError);

    // Still throws — the caller renders its own "sign in to see this" state.
    await expect(apiRequest('/api/drive/providers')).rejects.toThrow('Missing or malformed Authorization header');

    expect(onGlobalError).not.toHaveBeenCalled();
    window.removeEventListener(API_ERROR_EVENT, onGlobalError);
  });

  it('does not report an anonymous 401 on the streaming transport either', async () => {
    vi.mocked(getStoredTenantToken).mockReturnValue(null);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(missingAuthHeaderResponse());
    const onGlobalError: EventListener = vi.fn();
    window.addEventListener(API_ERROR_EVENT, onGlobalError);

    const res = await apiRequestStream('/api/drive/connections/1/files/abc');
    expect(res.status).toBe(401);

    expect(onGlobalError).not.toHaveBeenCalled();
    window.removeEventListener(API_ERROR_EVENT, onGlobalError);
  });

  /** Narrow on purpose: a 401 WITH a token is a real expired session. */
  it('still reports a 401 when a token was actually sent', async () => {
    vi.mocked(getStoredTenantToken).mockReturnValue('tenant-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'Token expired',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    const onGlobalError: EventListener = vi.fn();
    window.addEventListener(API_ERROR_EVENT, onGlobalError);

    await expect(apiRequest('/api/drive/providers')).rejects.toThrow('Token expired');

    expect(onGlobalError).toHaveBeenCalledTimes(1);
    window.removeEventListener(API_ERROR_EVENT, onGlobalError);
  });

  /** Suppression keys off the CODE, never the status: 428 is also a real,
   *  actionable failure (publishing with a missing project secret). */
  it('still reports a 428 that is not a gate signal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'This project has no ROBLOX_API_KEY secret. Add one before publishing to Roblox.',
    }), { status: 428, headers: { 'Content-Type': 'application/json' } }));
    const onGlobalError: EventListener = vi.fn();
    window.addEventListener(API_ERROR_EVENT, onGlobalError);

    await expect(apiRequest('/api/game/publish', { method: 'POST' })).rejects.toThrow(/ROBLOX_API_KEY/);

    expect(onGlobalError).toHaveBeenCalledTimes(1);
    window.removeEventListener(API_ERROR_EVENT, onGlobalError);
  });
});
