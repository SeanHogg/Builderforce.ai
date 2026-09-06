import { describe, expect, it } from 'vitest';
import { hmacBase64, hmacBase64Url, hmacHex, hmacSign, hmacVerify } from './hmac';

describe('hmac', () => {
  // RFC 4231 test case 2.
  const key = 'Jefe';
  const message = 'what do ya want for nothing?';
  const hex = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';

  it('matches the RFC 4231 vector in every encoding', async () => {
    expect(await hmacHex(key, message)).toBe(hex);
    expect(await hmacBase64(key, message)).toBe('W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=');
    expect(await hmacBase64Url(key, message)).toBe('W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM');
  });

  it('accepts byte keys and byte messages', async () => {
    const enc = new TextEncoder();
    expect(await hmacHex(enc.encode(key), enc.encode(message))).toBe(hex);
  });

  it('verifies what it signed, and nothing else', async () => {
    const sig = await hmacSign(key, message);
    expect(await hmacVerify(key, message, sig)).toBe(true);
    expect(await hmacVerify(key, `${message}!`, sig)).toBe(false);
    expect(await hmacVerify('other', message, sig)).toBe(false);
  });

  it('takes the hash the vendor specifies', async () => {
    expect(await hmacHex(key, message, 'SHA-1')).toBe('effcdf6ae5eb2fa2d27416d5f184df9c259a7c79');
  });
});
