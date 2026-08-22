// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import {
  ApiTransportError,
  TRANSPORT_FAILURE_STATUS,
  resetTransportFailureWindow,
} from './errors/transportFailure';
import { PRODUCT_REPORT_ERROR_STATUSES } from './reportError';

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

/**
 * The gateway answers a cascade-exhausted 429 with OpenAI's envelope, nesting
 * the real fields one level down: `{ error: { message, code, type, details } }`.
 * Read as the flat shape, `error` is an OBJECT — and it was handed straight to
 * the error toast, which rendered it as a React child and took the canvas down
 * with "Objects are not valid as a React child (found: object with keys
 * {message, code, type, details})".
 */
describe('apiRequest nested gateway error envelope', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  function cascadeExhaustedResponse(): Response {
    return new Response(JSON.stringify({
      error: {
        message: 'Image vendor cascade exhausted. Retry shortly or simplify the prompt.',
        code: 429,
        type: 'rate_limit_error',
        details: { failovers: [{ model: 'together/Lykon/DreamShaper', vendor: 'together', code: 0 }] },
      },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  }

  it('throws the nested message as a string, never the envelope object', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(cascadeExhaustedResponse());

    await expect(apiRequest('/llm/v1/images/generations', { method: 'POST' }))
      .rejects.toThrow('Image vendor cascade exhausted. Retry shortly or simplify the prompt.');
  });

  it('reports a string message and the nested code, so the toast can render it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(cascadeExhaustedResponse());
    let detail: { message?: unknown; code?: unknown; details?: unknown } | undefined;
    const onGlobalError = ((event: Event) => { detail = (event as CustomEvent).detail; }) as EventListener;
    window.addEventListener(API_ERROR_EVENT, onGlobalError);

    await expect(apiRequest('/llm/v1/images/generations', { method: 'POST' })).rejects.toThrow();

    expect(typeof detail?.message).toBe('string');
    expect(detail?.message).toContain('cascade exhausted');
    // The numeric `code: 429` is normalised to a string for every consumer.
    expect(detail?.code).toBe('429');
    expect(detail?.details).toMatchObject({ failovers: expect.any(Array) });
    window.removeEventListener(API_ERROR_EVENT, onGlobalError);
  });

  /** The flat envelope is still the common one and must not regress. */
  it('still reads the flat string envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: 'message is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(apiRequest('/api/quality-ingest/product-report', { method: 'POST' }))
      .rejects.toThrow('message is required');
  });
});

/**
 * A `fetch` that REJECTS was the one outcome none of the three transports
 * handled. The `TypeError` escaped the client, so nothing toasted, nothing was
 * reported, and the only account of the failure was the browser console — which
 * calls it a CORS error. That is why the 2026-07-09 "CORS error for everyone"
 * login outage could not be traced afterwards: the request never reached the
 * worker, so there was no server-side record to find, and the client kept none.
 */
describe('a request that never reached a server', () => {
  beforeEach(() => {
    resetTransportFailureWindow();
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('throws a typed transport error instead of a bare TypeError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiRequest('/api/auth/login', { method: 'POST' }))
      .rejects.toBeInstanceOf(ApiTransportError);
  });

  it('reports the outage so it lands in the product Quality feed', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    let detail: { status?: number; code?: string; url?: string } | undefined;
    const onGlobalError = ((event: Event) => { detail = (event as CustomEvent).detail; }) as EventListener;
    window.addEventListener(API_ERROR_EVENT, onGlobalError);

    await expect(apiRequest('/api/auth/login', { method: 'POST' })).rejects.toThrow();

    expect(detail?.status).toBe(TRANSPORT_FAILURE_STATUS);
    expect(detail?.code).toBe('unreachable');
    expect(detail?.url).toContain('/api/auth/login');
    window.removeEventListener(API_ERROR_EVENT, onGlobalError);
  });

  /** The reporter's own request fails too during an outage. It must not recurse. */
  it('stays silent for a caller that lists status 0 in expectedErrors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const onGlobalError: EventListener = vi.fn();
    window.addEventListener(API_ERROR_EVENT, onGlobalError);

    await expect(apiRequest('/product-report', {
      method: 'POST',
      expectedErrors: PRODUCT_REPORT_ERROR_STATUSES,
    })).rejects.toBeInstanceOf(ApiTransportError);

    expect(onGlobalError).not.toHaveBeenCalled();
    window.removeEventListener(API_ERROR_EVENT, onGlobalError);
  });

  /** Every transport shares one send, so none of them can miss the case. */
  it('covers the streaming transport too', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiRequestStream('/api/brain/stream', { method: 'POST' }))
      .rejects.toBeInstanceOf(ApiTransportError);
  });
});
