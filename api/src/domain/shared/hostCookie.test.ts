import { describe, expect, it } from 'vitest';
import {
  hostCookieName,
  hostCookieUpgrade,
  hostSetCookie,
  legacyCookieExpiry,
  readCookie,
  readHostCookie,
  readHostCookieEntry,
  readHostCookieValues,
  withSetCookies,
} from './hostCookie';

describe('hostCookie', () => {
  it('writes only the __Host- name, Secure, Path=/ and never a Domain', () => {
    const header = hostSetCookie('bf_x', 'v', 'HttpOnly; SameSite=Lax');
    expect(header).toBe('__Host-bf_x=v; Path=/; Secure; HttpOnly; SameSite=Lax');
    expect(header).not.toMatch(/Domain=/i);
    expect(hostSetCookie('bf_x', 'v', '')).toBe('__Host-bf_x=v; Path=/; Secure');
    expect(hostCookieName('bf_x')).toBe('__Host-bf_x');
  });

  it('reads the __Host- name, falls back to the legacy name, and prefers __Host- when both are present', () => {
    expect(readHostCookie('__Host-bf_x=new', 'bf_x')).toBe('new');
    expect(readHostCookie('bf_x=old', 'bf_x')).toBe('old');
    expect(readHostCookie('bf_x=old; __Host-bf_x=new', 'bf_x')).toBe('new');
    expect(readHostCookie('__Host-bf_x=new; bf_x=old', 'bf_x')).toBe('new');
    expect(readHostCookie('other=1', 'bf_x')).toBeNull();
    expect(readHostCookie(null, 'bf_x')).toBeNull();
    expect(readHostCookie('bf_x=', 'bf_x')).toBeNull();
  });

  it('says which name carried the value, and when a legacy read is unambiguous enough to upgrade', () => {
    expect(readHostCookieEntry('__Host-bf_x=new; bf_x=old', 'bf_x')).toEqual({ value: 'new', legacy: false, upgradable: false });
    expect(readHostCookieEntry('bf_x=old', 'bf_x')).toEqual({ value: 'old', legacy: true, upgradable: true });
    // Two legacy values: one may be a sibling-planted cookie — read, but never promote.
    expect(readHostCookieEntry('bf_x=planted; bf_x=real', 'bf_x')).toEqual({ value: 'planted', legacy: true, upgradable: false });
  });

  it('collects EVERY value under both names for a revocation — a planted cookie listed first cannot hide the real one', () => {
    expect(readHostCookieValues('bf_x=old; __Host-bf_x=new', 'bf_x')).toEqual(['new', 'old']);
    expect(readHostCookieValues('bf_x=same; __Host-bf_x=same', 'bf_x')).toEqual(['same']);
    // A longer-Path planted cookie is sent FIRST; the user's real one follows under the same name.
    expect(readHostCookieValues('bf_x=planted; bf_x=real', 'bf_x')).toEqual(['planted', 'real']);
    expect(readHostCookieValues('__Host-bf_x=a; __Host-bf_x=b; bf_x=c', 'bf_x')).toEqual(['a', 'b', 'c']);
    expect(readHostCookieValues(null, 'bf_x')).toEqual([]);
  });

  it('upgrades on read: re-issues a legacy-only value as __Host- and expires the legacy cookie', () => {
    const read = readHostCookieEntry('bf_x=old', 'bf_x');
    expect(hostCookieUpgrade(read, 'bf_x', 'HttpOnly; SameSite=Lax', 60)).toEqual([
      '__Host-bf_x=old; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=60',
      'bf_x=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
    ]);
    expect(hostCookieUpgrade(read, 'bf_x', 'HttpOnly; SameSite=Lax')).toEqual([
      '__Host-bf_x=old; Path=/; Secure; HttpOnly; SameSite=Lax',
      'bf_x=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
    ]);
    expect(hostCookieUpgrade(read, 'bf_x', 'HttpOnly', 0)).toEqual([]);
    expect(hostCookieUpgrade(readHostCookieEntry('__Host-bf_x=new; bf_x=old', 'bf_x'), 'bf_x', 'HttpOnly', 60)).toEqual([]);
    expect(hostCookieUpgrade(readHostCookieEntry('bf_x=a; bf_x=b', 'bf_x'), 'bf_x', 'HttpOnly', 60)).toEqual([]);
    expect(hostCookieUpgrade(null, 'bf_x', 'HttpOnly', 60)).toEqual([]);
    expect(legacyCookieExpiry('bf_site_session', 'HttpOnly; SameSite=Lax')).toBe('bf_site_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
  });

  it('appends Set-Cookies to a copy of the response', () => {
    const original = new Response('x', { status: 201, headers: { 'Set-Cookie': 'a=1' } });
    const out = withSetCookies(original, ['b=2', 'c=3']);
    expect(out.status).toBe(201);
    expect(out.headers.get('set-cookie')).toBe('a=1, b=2, c=3');
    expect(withSetCookies(original, [])).toBe(original);
  });

  it('decodes values and treats a malformed escape as absent', () => {
    expect(readCookie('a=x%20y', 'a')).toBe('x y');
    expect(readCookie('a=%', 'a')).toBeNull();
  });
});
