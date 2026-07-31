import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  login,
  register,
  verifyEmailCode,
  resendVerificationCode,
  getMyTenants,
  getTenantToken,
  persistSession,
  persistTenantSession,
  clearSession,
  getStoredWebToken,
  getStoredTenantToken,
  getStoredUser,
  getStoredTenant,
} from './auth';
import type { AuthUser, Tenant } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockOk(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function mockError(status: number, message?: string) {
  return Promise.resolve(
    new Response(JSON.stringify({ message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

const sampleUser: AuthUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
};

const sampleTenant: Tenant = {
  id: 'tenant-1',
  name: 'Acme Corp',
  slug: 'acme',
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.fn>;

// Minimal localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('document', { cookie: '' });
  localStorageMock.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

describe('login', () => {
  it('POSTs to /api/auth/web/login and returns a session', async () => {
    fetchSpy.mockResolvedValueOnce(mockOk({ token: 'web-token-123', user: sampleUser }));
    const result = await login('test@example.com', 'password123');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/auth\/web\/login$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.email).toBe('test@example.com');
    expect(body.password).toBe('password123');
    if (result.needsVerification) throw new Error('expected a session, got verification step');
    expect(result.token).toBe('web-token-123');
    expect(result.user.id).toBe('user-1');
  });

  it('returns the verification step (not an error) for an unverified account', async () => {
    fetchSpy.mockResolvedValueOnce(
      Promise.resolve(new Response(JSON.stringify({ verificationRequired: true, email: 'u@x.com' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      }))
    );
    const result = await login('u@x.com', 'pw');
    expect(result.needsVerification).toBe(true);
    if (!result.needsVerification) throw new Error('expected verification step');
    expect(result.email).toBe('u@x.com');
  });

  it('throws with server message on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(401, 'Invalid credentials'));
    await expect(login('bad@example.com', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it('throws fallback message when server body has no message', async () => {
    fetchSpy.mockResolvedValueOnce(
      Promise.resolve(new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }))
    );
    await expect(login('x@x.com', 'p')).rejects.toThrow('Login failed');
  });
});

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

describe('register', () => {
  it('POSTs to /api/auth/web/register and returns the verification step', async () => {
    fetchSpy.mockResolvedValueOnce(
      Promise.resolve(new Response(JSON.stringify({ verificationRequired: true, email: 'new@example.com' }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      }))
    );
    const result = await register('new@example.com', 'secret123', 'Test User', true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/auth\/web\/register$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('Test User');
    expect(body.agreeToTerms).toBe(true);
    expect(result.needsVerification).toBe(true);
    if (!result.needsVerification) throw new Error('expected verification step');
    expect(result.email).toBe('new@example.com');
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(409, 'Email already exists'));
    await expect(register('dup@example.com', 'pass', undefined, true)).rejects.toThrow('Email already exists');
  });
});

// ---------------------------------------------------------------------------
// verifyEmailCode / resendVerificationCode
// ---------------------------------------------------------------------------

describe('verifyEmailCode', () => {
  it('POSTs the code and returns a session', async () => {
    fetchSpy.mockResolvedValueOnce(mockOk({ token: 'verified-token', user: sampleUser }));
    const result = await verifyEmailCode('new@example.com', '123456', true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/auth\/web\/register\/verify$/);
    const body = JSON.parse(init.body as string);
    expect(body.code).toBe('123456');
    expect(body.trustDevice).toBe(true);
    expect(result.token).toBe('verified-token');
  });

  it('throws an Error carrying the server reason code', async () => {
    fetchSpy.mockResolvedValueOnce(
      Promise.resolve(new Response(JSON.stringify({ error: 'This code has expired.', reason: 'expired' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      }))
    );
    await expect(verifyEmailCode('x@x.com', '000000', false)).rejects.toMatchObject({ reason: 'expired' });
  });
});

describe('resendVerificationCode', () => {
  it('POSTs and surfaces a cooldown when throttled', async () => {
    fetchSpy.mockResolvedValueOnce(mockOk({ ok: true, cooldownSeconds: 42 }));
    const result = await resendVerificationCode('new@example.com');
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/auth\/web\/register\/resend$/);
    expect(result.cooldownSeconds).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// getMyTenants
// ---------------------------------------------------------------------------

describe('getMyTenants', () => {
  it('GETs /api/auth/my-tenants with Bearer token', async () => {
    fetchSpy.mockResolvedValueOnce(mockOk([sampleTenant]));
    const result = await getMyTenants('web-token-123');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/auth\/my-tenants$/);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer web-token-123');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('tenant-1');
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(401, 'Unauthorized'));
    await expect(getMyTenants('bad-token')).rejects.toThrow('Session expired');
  });
});

// ---------------------------------------------------------------------------
// getTenantToken
// ---------------------------------------------------------------------------

describe('getTenantToken', () => {
  it('POSTs to /api/auth/tenant-token with tenantId', async () => {
    fetchSpy.mockResolvedValueOnce(mockOk({ token: 'tenant-token-xyz' }));
    const result = await getTenantToken('web-token-123', '42');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/auth\/tenant-token$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.tenantId).toBe(42);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer web-token-123');
    expect(result.token).toBe('tenant-token-xyz');
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(403, 'Forbidden'));
    await expect(getTenantToken('token', 'tenant-x')).rejects.toThrow('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// persistSession / getStored* / clearSession
// ---------------------------------------------------------------------------

describe('persistSession and storage helpers', () => {
  it('stores webToken and user in localStorage', () => {
    vi.stubGlobal('window', {});
    persistSession('wt-1', sampleUser);
    expect(getStoredWebToken()).toBe('wt-1');
    expect(getStoredUser()?.id).toBe('user-1');
    expect(getStoredTenantToken()).toBeNull();
  });

  it('also stores tenantToken and tenant when provided', () => {
    vi.stubGlobal('window', {});
    persistSession('wt-1', sampleUser, 'tt-1', sampleTenant);
    expect(getStoredTenantToken()).toBe('tt-1');
    expect(getStoredTenant()?.id).toBe('tenant-1');
  });

  it('clearSession removes all stored values', () => {
    vi.stubGlobal('window', {});
    persistSession('wt-1', sampleUser, 'tt-1', sampleTenant);
    clearSession();
    expect(getStoredWebToken()).toBeNull();
    expect(getStoredTenantToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
    expect(getStoredTenant()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// persistTenantSession
// ---------------------------------------------------------------------------

describe('persistTenantSession', () => {
  it('stores tenant token and tenant', () => {
    vi.stubGlobal('window', {});
    persistTenantSession('tt-99', sampleTenant);
    expect(getStoredTenantToken()).toBe('tt-99');
    expect(getStoredTenant()?.name).toBe('Acme Corp');
  });
});
