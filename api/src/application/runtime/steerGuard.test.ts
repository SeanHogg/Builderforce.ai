import { describe, expect, it, vi } from 'vitest';
import { STEER_MAX_TEXT_CHARS, STEER_RATE_LIMIT_PER_MINUTE, steerRateLimited, steerTextTooLong } from './steerGuard';

/** A TENANT_RATE_LIMITER whose DO answers like the real sliding window: allow up to `limit`. */
function limiterEnv() {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: vi.fn(async (req: Request) => {
        keys.push(name);
        const { limit } = (await req.json()) as { limit: number };
        const current = (counts.get(name) ?? 0) + 1;
        counts.set(name, current);
        return new Response(JSON.stringify({
          allowed: current <= limit, current, limit, resetAt: new Date(Date.now() + 30_000).toISOString(),
        }));
      }),
    }),
  };
  return { env: { TENANT_RATE_LIMITER: namespace as unknown as DurableObjectNamespace }, keys };
}

describe('steerTextTooLong (PRD 09 S3)', () => {
  it('allows text up to the cap and refuses one character beyond it', () => {
    expect(steerTextTooLong('a'.repeat(STEER_MAX_TEXT_CHARS))).toBe(false);
    expect(steerTextTooLong('a'.repeat(STEER_MAX_TEXT_CHARS + 1))).toBe(true);
  });
});

describe('steerRateLimited (PRD 09 S3)', () => {
  it('admits the first N steers a minute and refuses the next with a Retry-After', async () => {
    const { env } = limiterEnv();
    for (let i = 0; i < STEER_RATE_LIMIT_PER_MINUTE; i += 1) {
      expect(await steerRateLimited(env, 5)).toBeNull();
    }
    const retryAfter = await steerRateLimited(env, 5);
    expect(retryAfter).not.toBeNull();
    expect(retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('keeps a bucket PER EXECUTION - a busy run does not throttle another', async () => {
    const { env, keys } = limiterEnv();
    for (let i = 0; i < STEER_RATE_LIMIT_PER_MINUTE + 1; i += 1) await steerRateLimited(env, 5);
    expect(await steerRateLimited(env, 6)).toBeNull();
    expect(new Set(keys)).toEqual(new Set(['steer:5', 'steer:6']));
  });

  it('fails open when the limiter binding is absent or throws', async () => {
    expect(await steerRateLimited({}, 5)).toBeNull();
    const broken = { TENANT_RATE_LIMITER: { idFromName: () => 'x', get: () => { throw new Error('do down'); } } as unknown as DurableObjectNamespace };
    expect(await steerRateLimited(broken, 5)).toBeNull();
  });
});
