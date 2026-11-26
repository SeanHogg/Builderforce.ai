// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../auth')>();
  return {
    ...original,
    // The real one also navigates; the test only needs to know the session was ended.
    handleApiUnauthorized: vi.fn((): never => {
      original.clearSession();
      throw new Error('Session expired');
    }),
  };
});

/** The mock instance the module under test imported (the registry is reset between tests). */
const signOutSpy = async () => (await import('../auth')).handleApiUnauthorized as ReturnType<typeof vi.fn>;

const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
const nowSec = () => Math.floor(Date.now() / 1000);
const WEB_KEY = 'bf_web_token';

/** A web token issued `ageSec` ago that lives `lifeSec` in total. */
function webToken(lifeSec: number, ageSec = 0, extra: Record<string, unknown> = {}): string {
  return jwt({ sub: 'u1', iat: nowSec() - ageSec, exp: nowSec() - ageSec + lifeSec, ...extra });
}

function renewResponse(token: string): Response {
  return new Response(JSON.stringify({ token }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(async () => {
  localStorage.clear();
  // The mock factory's result outlives `vi.resetModules()`, so its call history does too.
  (await signOutSpy()).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('renewalDelayMs', () => {
  it('is 75% of the remaining life', async () => {
    const { renewalDelayMs } = await import('./tokenRenewal');
    const now = 1_000_000_000_000;
    const token = jwt({ iat: now / 1000, exp: now / 1000 + 800 });
    expect(renewalDelayMs(token, now)).toBe(600_000);
  });

  it('is immediate for a lapsed token and null for an unreadable one', async () => {
    const { renewalDelayMs } = await import('./tokenRenewal');
    expect(renewalDelayMs(webToken(900, 1000))).toBe(0);
    expect(renewalDelayMs('not-a-jwt')).toBeNull();
    expect(renewalDelayMs(null)).toBeNull();
  });
});

describe('scheduled renewal', () => {
  it('renews once, at 75% of the remaining life, and stores the new token', async () => {
    vi.useFakeTimers();
    const fresh = webToken(900);
    const original = webToken(800);
    localStorage.setItem(WEB_KEY, original);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(renewResponse(fresh));
    const { startTokenRenewal } = await import('./tokenRenewal');

    const stop = startTokenRenewal();
    await vi.advanceTimersByTimeAsync(599_000);
    expect(fetchSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/api/auth/web/renew');
    expect(localStorage.getItem(WEB_KEY)).toBe(fresh);
    stop();
  });

  it('signs out when the session has reached its maximum age', async () => {
    vi.useFakeTimers();
    localStorage.setItem(WEB_KEY, webToken(900, 1000));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'session_expired' }), { status: 401 }),
    );
    const { startTokenRenewal } = await import('./tokenRenewal');

    const stop = startTokenRenewal();
    await vi.advanceTimersByTimeAsync(10);
    expect(await signOutSpy()).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(WEB_KEY)).toBeNull();
    stop();
  });

  it('does not sign out when the renewal could not be reached, and retries', async () => {
    vi.useFakeTimers();
    localStorage.setItem(WEB_KEY, webToken(900, 1000));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    const { startTokenRenewal, RENEW_RETRY_MS } = await import('./tokenRenewal');

    const stop = startTokenRenewal();
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RENEW_RETRY_MS + 10);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(await signOutSpy()).not.toHaveBeenCalled();
    expect(localStorage.getItem(WEB_KEY)).not.toBeNull();
    stop();
  });

  it('renews on focus only when the token is near its end', async () => {
    const fresh = webToken(900);
    localStorage.setItem(WEB_KEY, webToken(900, 100));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(renewResponse(fresh));
    const { startTokenRenewal, SESSION_RENEWED_EVENT } = await import('./tokenRenewal');

    const stop = startTokenRenewal(); // timer armed ~10 minutes out
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchSpy).not.toHaveBeenCalled();

    // The tab slept: the stored token is now in its last quarter, with no timer having fired.
    localStorage.setItem(WEB_KEY, webToken(900, 800));
    const renewed = new Promise<void>((resolve) => window.addEventListener(SESSION_RENEWED_EVENT, () => resolve(), { once: true }));
    window.dispatchEvent(new Event('focus'));
    await renewed;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(WEB_KEY)).toBe(fresh);
    stop();
  });
});

describe('single flight', () => {
  it('shares one attempt between concurrent callers in a tab', async () => {
    localStorage.setItem(WEB_KEY, webToken(900, 800));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(renewResponse(webToken(900)));
    const { renewSession } = await import('./tokenRenewal');

    const [a, b] = await Promise.all([renewSession(), renewSession()]);
    expect([a, b]).toEqual(['renewed', 'renewed']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('lets only one of two tabs renew; the other adopts the new token', async () => {
    const fresh = webToken(900);
    localStorage.setItem(WEB_KEY, webToken(900, 800));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return renewResponse(fresh);
    });

    // Two module instances over the same localStorage stand in for two tabs.
    const tabA = await import('./tokenRenewal');
    vi.resetModules();
    const tabB = await import('./tokenRenewal');
    expect(tabA).not.toBe(tabB);

    const first = tabA.renewSession();
    const second = tabB.renewSession();
    expect(await first).toBe('renewed');
    expect(await second).toBe('adopted');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(WEB_KEY)).toBe(fresh);
    expect(localStorage.getItem('bf_renew_lock')).toBeNull();
  });
});

describe('renewAfterUnauthorized', () => {
  it('renews and reports true so the request is retried', async () => {
    const stale = webToken(900, 1000);
    localStorage.setItem(WEB_KEY, stale);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(renewResponse(webToken(900)));
    const { renewAfterUnauthorized } = await import('./tokenRenewal');
    expect(await renewAfterUnauthorized(`Bearer ${stale}`)).toBe(true);
  });

  it('reports true without renewing when the token the request carried was already replaced', async () => {
    localStorage.setItem(WEB_KEY, webToken(900));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { renewAfterUnauthorized } = await import('./tokenRenewal');
    expect(await renewAfterUnauthorized('Bearer some-older-token')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports false when the session is over, leaving sign-out to the caller', async () => {
    const stale = webToken(900, 1000);
    localStorage.setItem(WEB_KEY, stale);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'session_expired' }), { status: 401 }));
    const { renewAfterUnauthorized } = await import('./tokenRenewal');
    expect(await renewAfterUnauthorized(`Bearer ${stale}`)).toBe(false);
    expect(await signOutSpy()).not.toHaveBeenCalled();
  });

  it('is a no-op with no session', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { renewAfterUnauthorized } = await import('./tokenRenewal');
    expect(await renewAfterUnauthorized('Bearer x')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
