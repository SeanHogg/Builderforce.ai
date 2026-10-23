/**
 * The gateway's exact-cache key: the shared eligibility reading (`cacheEligibilityOf`)
 * and THE cache scope (`cacheScope.ts`) — so an answer one principal produced is never
 * replayed to another, and a project answer never leaks across projects.
 */
import { describe, expect, it } from 'vitest';
import { responseCacheKeyFor } from './proxyResponseCache';
import type { ChatCompletionRequest } from './proxyTypes';

const body = {
  model: 'openai/gpt-test',
  useCase: 'classification',
  temperature: 0,
  messages: [{ role: 'user', content: 'Classify: refund request' }],
} as unknown as ChatCompletionRequest;

describe('responseCacheKeyFor', () => {
  it('needs the caller grant AND an eligible request', async () => {
    expect(await responseCacheKeyFor(body, undefined)).toBeNull();
    expect(await responseCacheKeyFor({ ...body, stream: true }, { tenantId: 1 })).toBeNull();
    expect(await responseCacheKeyFor({ ...body, tools: [{ type: 'function' }] } as never, { tenantId: 1 })).toBeNull();
    expect(await responseCacheKeyFor({ ...body, useCase: 'chat' } as never, { tenantId: 1 })).toBeNull();
    expect(await responseCacheKeyFor({ ...body, temperature: 0.9 }, { tenantId: 1 })).toBeNull();
  });

  it('a tenant-internal grant keys on the tenant principal', async () => {
    expect(await responseCacheKeyFor(body, { tenantId: 1 })).toMatch(/^respcache:t1:p-:tenant:m-:[0-9a-f]{64}$/);
  });

  it('two principals, or two projects, never share a key', async () => {
    const alice = await responseCacheKeyFor(body, { tenantId: 1, principal: { userId: 'alice', role: 'member' } });
    const bob = await responseCacheKeyFor(body, { tenantId: 1, principal: { userId: 'bob', role: 'member' } });
    const p1 = await responseCacheKeyFor(body, { tenantId: 1, projectId: 1 });
    const p2 = await responseCacheKeyFor(body, { tenantId: 1, projectId: 2 });
    expect(alice).not.toBe(bob);
    expect(p1).not.toBe(p2);
    expect(alice).toContain(':member.user-alice:');
  });
});
