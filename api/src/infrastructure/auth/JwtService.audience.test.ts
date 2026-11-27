/**
 * SEC-G017: deny by default. Every verifier refuses a token carrying `aud` unless the
 * caller passes `{ allowAudience: true }` (only authMiddleware does); ordinary tokens are
 * unaffected.
 */
import { describe, expect, it } from 'vitest';
import {
  signEmulationJwt,
  signJwt,
  signOpaqueJwt,
  signWebJwt,
  verifyEmulationJwt,
  verifyJwt,
  verifyOpaqueJwt,
  verifyWebJwt,
  AUDIENCE_REFUSED_MESSAGE,
} from './JwtService';
import { TenantRole } from '../../domain/shared/types';

const SECRET = 'test-secret';
const base = { sub: 'u1', tid: 7, role: TenantRole.MANAGER };

describe('audience-bound tokens are refused by every verifier', () => {
  it('verifyJwt refuses aud unless allowAudience is passed', async () => {
    const token = await signJwt({ ...base, aud: 'spawn' }, SECRET, 900);
    await expect(verifyJwt(token, SECRET)).rejects.toThrow(AUDIENCE_REFUSED_MESSAGE);
    await expect(verifyJwt(token, SECRET, { allowAudience: false })).rejects.toThrow(AUDIENCE_REFUSED_MESSAGE);
    expect((await verifyJwt(token, SECRET, { allowAudience: true })).aud).toBe('spawn');
  });

  it('verifyWebJwt refuses aud (including with ignoreExpiry)', async () => {
    const token = await signJwt({ ...base, aud: 'spawn' }, SECRET, 900);
    await expect(verifyWebJwt(token, SECRET)).rejects.toThrow(AUDIENCE_REFUSED_MESSAGE);
    await expect(verifyWebJwt(token, SECRET, { ignoreExpiry: true })).rejects.toThrow(AUDIENCE_REFUSED_MESSAGE);
  });

  it('verifyEmulationJwt refuses aud', async () => {
    const token = await signJwt({ ...base, aud: 'spawn', emu: true } as never, SECRET, 900);
    await expect(verifyEmulationJwt(token, SECRET)).rejects.toThrow(AUDIENCE_REFUSED_MESSAGE);
  });

  it('verifyOpaqueJwt refuses aud', async () => {
    const token = await signOpaqueJwt({ typ: 'x', aud: 'spawn', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
    await expect(verifyOpaqueJwt(token, SECRET)).rejects.toThrow(AUDIENCE_REFUSED_MESSAGE);
  });
});

describe('ordinary tokens are unaffected', () => {
  it('verifies tenant, web, emulation and opaque tokens without aud', async () => {
    expect((await verifyJwt(await signJwt(base, SECRET, 900), SECRET)).sub).toBe('u1');
    const web = await signWebJwt({ sub: 'u1', email: 'a@b.c', username: 'u' }, SECRET);
    expect((await verifyWebJwt(web, SECRET)).sub).toBe('u1');
    expect((await verifyWebJwt(web, SECRET, { ignoreExpiry: true })).sub).toBe('u1');
    const emu = await signEmulationJwt({ sub: 'u1', tid: 7, role: TenantRole.MANAGER, emuBy: 'sa', emuSid: 's' }, SECRET);
    expect((await verifyEmulationJwt(emu, SECRET)).emu).toBe(true);
    const opaque = await signOpaqueJwt({ typ: 'x', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
    expect((await verifyOpaqueJwt<{ typ: string; exp: number }>(opaque, SECRET)).typ).toBe('x');
  });
});
