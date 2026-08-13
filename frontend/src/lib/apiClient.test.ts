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
import { onTermsGate } from './errors/termsGateEvent';

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
