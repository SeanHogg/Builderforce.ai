/** resolveBearerTenantId selects the tenant to throttle, including for scoped (`aud`) tokens. */
import { describe, expect, it } from 'vitest';
import { signJwt } from '../../infrastructure/auth/JwtService';
import { resolveBearerTenantId } from './gatewayAccess';

const SECRET = 'test-secret';

function ctx(token: string) {
  return {
    env: { JWT_SECRET: SECRET },
    req: { header: (n: string) => (n === 'Authorization' ? `Bearer ${token}` : undefined), query: () => undefined },
  } as never;
}

describe('resolveBearerTenantId', () => {
  it('resolves a plain tenant JWT', async () => {
    const token = await signJwt({ sub: 'u1', tid: 7, role: 'manager' } as never, SECRET);
    expect(await resolveBearerTenantId(ctx(token))).toBe(7);
  });

  it('resolves a scoped aud:spawn token to its tenant so it is rate-limited, not bypassed', async () => {
    const token = await signJwt({ sub: 'u1', tid: 7, role: 'manager', aud: 'spawn' } as never, SECRET);
    expect(await resolveBearerTenantId(ctx(token))).toBe(7);
  });

  it('returns null for an unverifiable token', async () => {
    expect(await resolveBearerTenantId(ctx('garbage'))).toBeNull();
  });
});
