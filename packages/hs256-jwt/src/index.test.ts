import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, signHs256, tryDecodeJwtPayload, verifyHs256 } from './index';

const SECRET = 'test-secret';

describe('hs256-jwt', () => {
  it('round-trips a claim set', async () => {
    const token = await signHs256({ sub: 'u1', exp: 4_000_000_000 }, SECRET);
    expect(token.split('.')).toHaveLength(3);
    const verdict = await verifyHs256<{ sub: string; exp: number }>(token, SECRET);
    expect(verdict).toEqual({ ok: true, claims: { sub: 'u1', exp: 4_000_000_000 } });
  });

  it('refuses the wrong secret before it reads the body', async () => {
    const token = await signHs256({ sub: 'u1', exp: 4_000_000_000 }, SECRET);
    expect(await verifyHs256(token, 'other')).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses an expired token and a token from the future', async () => {
    const expired = await signHs256({ sub: 'u1', exp: 100 }, SECRET);
    expect(await verifyHs256(expired, SECRET, { nowSeconds: 200 })).toEqual({ ok: false, reason: 'expired' });
    const early = await signHs256({ sub: 'u1', exp: 500, nbf: 300 }, SECRET);
    expect(await verifyHs256(early, SECRET, { nowSeconds: 200 })).toEqual({ ok: false, reason: 'not_yet_valid' });
    expect((await verifyHs256(early, SECRET, { nowSeconds: 400 })).ok).toBe(true);
  });

  it('names a malformed token', async () => {
    expect(await verifyHs256('a.b', SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(await verifyHs256('a.b.c', SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(await verifyHs256('a.b.cccc', SECRET)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(() => decodeJwtPayload('nope')).toThrow('Malformed token');
    expect(tryDecodeJwtPayload('nope')).toBeNull();
  });

  it('decodes the payload without verifying it', async () => {
    const token = await signHs256({ jti: 'j1', exp: 1 }, SECRET);
    expect(decodeJwtPayload<{ jti: string }>(token).jti).toBe('j1');
  });
});
