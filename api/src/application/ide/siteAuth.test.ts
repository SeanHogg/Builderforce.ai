import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  selects: 0,
}));

vi.mock('./appsDatabase', () => ({
  appsDatabaseOf: () => ({
    select: () => {
      mocks.selects += 1;
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.innerJoin = () => chain;
      chain.where = () => chain;
      chain.limit = async () => mocks.rows;
      return chain;
    },
  }),
}));

import {
  SITE_SESSION_COOKIE,
  siteSessionCookie,
  siteSessionCookieHeader,
  siteSessionCookies,
  siteSessionLegacyExpiry,
  siteSessionUpgradeCookies,
} from './siteAuth';

const NEW = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const NOW = Date.parse('2026-11-18T12:00:00.000Z');
const db = {} as never;

beforeEach(() => {
  mocks.rows = [{ userId: 1, email: 'u@example.com', displayName: null, status: 'active', expiresAt: new Date(NOW + 3600_000) }];
  mocks.selects = 0;
});

describe('site session cookie', () => {
  it('is written under the __Host- name without a Domain', () => {
    const header = siteSessionCookieHeader(NEW, 60);
    expect(header).toBe(`__Host-${SITE_SESSION_COOKIE}=${NEW}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=60`);
    expect(header).not.toMatch(/Domain=/i);
    expect(siteSessionCookieHeader(null, 60)).toBe(`__Host-${SITE_SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  });

  it('reads the __Host- name, still honours the legacy name, and prefers __Host- when both are present', () => {
    expect(siteSessionCookie(`__Host-bf_site_session=${NEW}`)).toBe(NEW);
    expect(siteSessionCookie(`bf_site_session=${OLD}`)).toBe(OLD);
    expect(siteSessionCookie(`bf_site_session=${OLD}; __Host-bf_site_session=${NEW}`)).toBe(NEW);
    expect(siteSessionCookie(null)).toBeNull();
  });

  it('hands a sign-out every token it carries, so a leftover legacy cookie is revoked too', () => {
    expect(siteSessionCookies(`bf_site_session=${OLD}; __Host-bf_site_session=${NEW}`)).toEqual([NEW, OLD]);
    // A planted longer-Path legacy cookie is sent first; the real one must still be revoked.
    expect(siteSessionCookies(`bf_site_session=${NEW}; bf_site_session=${OLD}`)).toEqual([NEW, OLD]);
  });

  it('sign-out deletes the legacy cookie too', () => {
    expect(siteSessionLegacyExpiry()).toBe('bf_site_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
  });
});

describe('siteSessionUpgradeCookies (upgrade on read)', () => {
  it('re-issues a live legacy-only session as __Host- for its remaining lifetime and expires the legacy cookie', async () => {
    expect(await siteSessionUpgradeCookies(db, 1, 7, `bf_site_session=${OLD}`, NOW)).toEqual([
      `__Host-bf_site_session=${OLD}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600`,
      'bf_site_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
    ]);
  });

  it('does nothing — and costs no lookup — when the __Host- cookie is present or no cookie is', async () => {
    expect(await siteSessionUpgradeCookies(db, 1, 7, `__Host-bf_site_session=${NEW}; bf_site_session=${OLD}`, NOW)).toEqual([]);
    expect(await siteSessionUpgradeCookies(db, 1, 7, null, NOW)).toEqual([]);
    expect(mocks.selects).toBe(0);
  });

  it('never promotes a legacy token that does not resolve, nor an ambiguous pair', async () => {
    mocks.rows = [];
    expect(await siteSessionUpgradeCookies(db, 1, 7, `bf_site_session=${OLD}`, NOW)).toEqual([]);
    mocks.rows = [{ userId: 1, email: 'u@example.com', displayName: null, status: 'active', expiresAt: new Date(NOW + 3600_000) }];
    expect(await siteSessionUpgradeCookies(db, 1, 7, `bf_site_session=${NEW}; bf_site_session=${OLD}`, NOW)).toEqual([]);
  });
});
