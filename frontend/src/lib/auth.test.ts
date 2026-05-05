import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  login,
  register,
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
  it('POSTs to /api/auth/web/login and returns token + user', async () => {
    fetchSpy.mockResolvedValueOnce(mockOk({ token: 'web-token-123', user: sampleUser }));
    const result = await login('test@example.com', 'password123');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/auth\/web\/login$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.email).toBe('test@example.com');
    expect(body.password).toBe('password123');
    expect(result.token).toBe('web-token-123');
    expect(result.user.id).toBe('user-1');
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
  it('POSTs to /api/auth/web/register with name and terms acceptance', async () => {
    fetchSpy.mockResolvedValueOnce(mockOk({ token: 'web-token-abc', user: sampleUser }));
    const result = await register('new@example.com', 'secret123', 'Test User', true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/auth\/web\/register$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('Test User');
    expect(body.agreeToTerms).toBe(true);
    expect(result.token).toBe('web-token-abc');
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(409, 'Email already exists'));
    await expect(register('dup@example.com', 'pass', undefined, true)).rejects.toThrow('Email already exists');
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
