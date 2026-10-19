/**
 * Activation must call `bootWebHost` with the network denied. `bootWebPlatformPolicy`
 * only sets flags and no-ops without `window` — it is not this proof.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const bootPath = resolve(dirname(fileURLToPath(import.meta.url)), 'PlatformPolicyBoot.tsx');

function executable(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('PlatformPolicyBoot', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('calls bootWebHost with the network denied at module evaluation, not in an effect', () => {
    const source = executable(readFileSync(bootPath, 'utf8'));
    const callAt = source.indexOf('bootWebHost(');
    expect(callAt).toBeGreaterThan(-1);
    expect(source).toContain("network: 'denied'");
    expect(callAt).toBeLessThan(source.indexOf('export function PlatformPolicyBoot'));
    expect(source.indexOf('activateDeniedWebHost()')).toBeGreaterThan(-1);
    expect(source.indexOf('activateDeniedWebHost()')).toBeLessThan(source.indexOf('export function PlatformPolicyBoot'));
    expect(source).toContain('bootWebPlatformPolicy()');
    expect(source).not.toContain('useEffect');
  });

  it('writes one durable record, and a second boot reads it back without a platform fetch', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('platform fetch must not be called')));
    vi.stubGlobal('fetch', fetchSpy);
    window.localStorage.clear();

    vi.resetModules();
    const policy = await import('@/lib/localFirst/platformPolicy');
    policy.resetWebPlatformPolicyForTests();
    const boot = await import('./PlatformPolicyBoot');

    const id = await boot.webHostActivation();
    expect(id).toBe(boot.WEB_HOST_ACTIVATION_ID);
    expect(fetchSpy).not.toHaveBeenCalled();

    render(<boot.PlatformPolicyBoot />);
    const store = boot.deniedWebHostStore();
    expect(store).toBeDefined();

    const second = policy.bootWebHost({
      network: 'denied',
      store,
      fetch: fetchSpy,
    });
    expect(await second.readDurable(id)).toEqual({
      id,
      title: boot.WEB_HOST_ACTIVATION_TITLE,
    });
    await expect(second.replayBatch()).resolves.toEqual({
      count: 0,
      idempotencyKey: `ticket:${id}:v1`,
    });
    const snapshot = await store!.export();
    expect(snapshot.records.filter((row) => row.entityType === 'ticket')).toHaveLength(1);
    expect(snapshot.records.some((row) => {
      const payload = row.payload as { kind?: string };
      return row.entityType === 'memory-fact' && payload.kind === policy.WEB_REPLAY_KIND;
    })).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    second.stop();
  });
});
