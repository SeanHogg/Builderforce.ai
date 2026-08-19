import { describe, expect, it } from 'vitest';
import { mintSessionExchangeCode, readSessionExchangeCode, safeRedirectPath } from './sessionExchange';

/**
 * The envelope that ends every federated sign-in. Its whole job is to be useless
 * as an API bearer and safe as a redirect target, so those are the properties
 * tested rather than the round trip alone.
 */
const SECRET = 'test-secret-not-a-real-one';

describe('safeRedirectPath', () => {
  it('keeps a same-origin relative path', () => {
    expect(safeRedirectPath('/create/abc')).toBe('/create/abc');
    expect(safeRedirectPath('/dashboard?tab=1')).toBe('/dashboard?tab=1');
  });

  it('refuses everything a browser would treat as leaving this origin', () => {
    // Each of these is a real open-redirect shape, not a hypothetical one.
    for (const hostile of [
      'https://evil.example',        // absolute
      '//evil.example',              // protocol-relative
      'javascript:alert(1)',         // scheme
      '/\\evil.example',             // backslash, normalised to `/` by browsers
      '',
      null,
      undefined,
    ]) {
      expect(safeRedirectPath(hostile), String(hostile)).toBe('/dashboard');
    }
  });
});

describe('session exchange envelope', () => {
  it('round-trips the identity and the landing path', async () => {
    const code = await mintSessionExchangeCode(SECRET, { uid: 'user-1', amr: 'sso', redirect: '/create/x' });
    const parsed = await readSessionExchangeCode(SECRET, code);
    expect(parsed).toEqual({ uid: 'user-1', amr: 'sso', redirect: '/create/x' });
  });

  it('is not readable with a different secret', async () => {
    const code = await mintSessionExchangeCode(SECRET, { uid: 'user-1', amr: 'lti', redirect: '/dashboard' });
    expect(await readSessionExchangeCode('another-secret', code)).toBeNull();
  });

  it('coerces a hostile redirect at MINT time, so it is never signed', async () => {
    const code = await mintSessionExchangeCode(SECRET, {
      uid: 'user-1', amr: 'oauth', redirect: 'https://evil.example/steal',
    });
    const parsed = await readSessionExchangeCode(SECRET, code);
    expect(parsed?.redirect).toBe('/dashboard');
  });

  it('rejects a tampered envelope rather than trusting its payload', async () => {
    const code = await mintSessionExchangeCode(SECRET, { uid: 'user-1', amr: 'sso', redirect: '/dashboard' });
    // Flip one character of the payload half. The HMAC no longer covers it.
    const broken = `${code.slice(0, 4)}${code[4] === 'a' ? 'b' : 'a'}${code.slice(5)}`;
    expect(await readSessionExchangeCode(SECRET, broken)).toBeNull();
  });
});
