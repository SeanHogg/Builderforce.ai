import { afterEach, describe, expect, it, vi } from 'vitest';
import { getExistingVisitorId, getVisitorId, VISITOR_MINTED_AT_KEY } from './visitor';

/**
 * `bf_visitor_id` is minted here before the session-replay recorder loads, so the
 * mint time is recorded beside it — and ONLY for a new id — for the recorder to
 * tell a new visitor from a returning one (`replay-sdk/src/ids.ts`).
 */

function clearCookies(): void {
  document.cookie.split(';').forEach((part) => {
    const name = part.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; max-age=0; path=/`;
  });
}

afterEach(() => {
  window.localStorage.clear();
  clearCookies();
  vi.useRealTimers();
});

describe('getVisitorId', () => {
  it('records the mint time when it mints a new id', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T09:00:00.000Z'));
    const id = getVisitorId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(window.localStorage.getItem('bf_visitor_id')).toBe(id);
    expect(window.localStorage.getItem(VISITOR_MINTED_AT_KEY)).toBe(String(Date.parse('2026-10-13T09:00:00.000Z')));
    expect(VISITOR_MINTED_AT_KEY).toBe('bf_visitor_minted_at');
  });

  it('does not touch the mint time for an id it reads back', () => {
    window.localStorage.setItem('bf_visitor_id', 'existingVisitor1');
    expect(getVisitorId()).toBe('existingVisitor1');
    expect(window.localStorage.getItem(VISITOR_MINTED_AT_KEY)).toBeNull();
  });

  it('keeps the first mint time across later calls', () => {
    const id = getVisitorId();
    const mintedAt = window.localStorage.getItem(VISITOR_MINTED_AT_KEY);
    expect(mintedAt).not.toBeNull();
    expect(getVisitorId()).toBe(id);
    expect(window.localStorage.getItem(VISITOR_MINTED_AT_KEY)).toBe(mintedAt);
  });

  it('falls back to the cookie without minting', () => {
    document.cookie = 'bf_visitor_id=cookieVisitor1; path=/';
    expect(getVisitorId()).toBe('cookieVisitor1');
    expect(window.localStorage.getItem(VISITOR_MINTED_AT_KEY)).toBeNull();
  });
});

describe('getExistingVisitorId', () => {
  it('never mints', () => {
    expect(getExistingVisitorId()).toBeNull();
    expect(window.localStorage.getItem('bf_visitor_id')).toBeNull();
  });
});
