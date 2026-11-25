import { describe, expect, it, vi } from 'vitest';
import { runInDurableObjectScope, runInRequestScope } from '../../application/shared/requestScope';
import { bumpVersion } from './versionToken';

function makeEnv() {
  const kv = { get: vi.fn(async () => null), put: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) };
  return { env: { AUTH_CACHE_KV: kv } as never, kv };
}

describe('bumpVersion', () => {
  it('is a no-op outside any scope', async () => {
    await expect(bumpVersion('k-none', 'test')).resolves.toBeUndefined();
  });

  it('bumps inside a Durable Object scope, deferring the KV delete', async () => {
    const { env, kv } = makeEnv();
    const waited: Promise<unknown>[] = [];
    await runInDurableObjectScope('TestDO', env, { waitUntil: (t) => { waited.push(t); } }, () => bumpVersion('k-do', 'test'));
    expect(waited).toHaveLength(1);
    await Promise.all(waited);
    expect(kv.delete).toHaveBeenCalledTimes(1);
  });

  it('dedupes repeat bumps of one key within a scope and awaits when nothing can defer', async () => {
    const { env, kv } = makeEnv();
    await runInRequestScope({ env }, async () => {
      await bumpVersion('k-dup', 'test');
      await bumpVersion('k-dup', 'test');
      await bumpVersion('k-other', 'test');
    });
    expect(kv.delete).toHaveBeenCalledTimes(2);
  });
});
