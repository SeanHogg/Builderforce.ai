import { describe, expect, it } from 'vitest';
import {
  signGuestToken, verifyGuestToken, isValidRoomCode, newRoomCode, GUEST_TOKEN_PREFIX,
} from './guestToken';

const SECRET = 'test-jwt-secret-value-long-enough';

describe('guest tokens', () => {
  it('round-trips a solo guest with no room binding', async () => {
    const token = await signGuestToken('visitor-abc', SECRET, 60);
    expect(token.startsWith(GUEST_TOKEN_PREFIX)).toBe(true);
    await expect(verifyGuestToken(token, SECRET)).resolves.toEqual({ visitorId: 'visitor-abc', roomCode: null });
  });

  it('carries the room code in the SIGNED payload, so membership cannot be self-asserted', async () => {
    const code = newRoomCode();
    const token = await signGuestToken('visitor-abc', SECRET, 60, code);
    await expect(verifyGuestToken(token, SECRET)).resolves.toEqual({ visitorId: 'visitor-abc', roomCode: code });

    // Tampering with the payload (e.g. swapping in another room's code) breaks the
    // HMAC — the combined room allowance depends on this being unforgeable.
    const [body = '', sig = ''] = token.slice(GUEST_TOKEN_PREFIX.length).split('.');
    const decoded = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    const forgedBody = btoa(JSON.stringify({ ...decoded, rid: newRoomCode() }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    await expect(verifyGuestToken(`${GUEST_TOKEN_PREFIX}${forgedBody}.${sig}`, SECRET)).resolves.toBeNull();
  });

  it('rejects a token signed with a different secret and an expired one', async () => {
    const other = await signGuestToken('visitor-abc', 'a-completely-different-secret', 60);
    await expect(verifyGuestToken(other, SECRET)).resolves.toBeNull();

    const expired = await signGuestToken('visitor-abc', SECRET, -10);
    await expect(verifyGuestToken(expired, SECRET)).resolves.toBeNull();
  });

  it('drops a malformed room code rather than trusting it as a room key', async () => {
    // A payload can only reach here signed, but a room code shape mismatch still
    // resolves to "solo" instead of being used to address a Durable Object.
    const token = await signGuestToken('visitor-abc', SECRET, 60, 'NOT A CODE');
    await expect(verifyGuestToken(token, SECRET)).resolves.toEqual({ visitorId: 'visitor-abc', roomCode: null });
  });
});

describe('room codes', () => {
  it('mints unguessable codes that validate', () => {
    const codes = new Set(Array.from({ length: 200 }, () => newRoomCode()));
    expect(codes.size).toBe(200); // no collisions across a realistic sample
    for (const code of codes) expect(isValidRoomCode(code)).toBe(true);
  });

  it('rejects codes that are the wrong shape', () => {
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode('short')).toBe(false);
    expect(isValidRoomCode('UPPERCASE123')).toBe(false);
    expect(isValidRoomCode('twelve-chars')).toBe(false);
    expect(isValidRoomCode(undefined)).toBe(false);
  });
});
