/**
 * Activation boots the policy at module evaluation and does nothing else: it
 * must not write a durable record. The denied-host durability proof is in
 * `lib/localFirst/deniedNetworkAcceptance.test.ts`.
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

  it('boots the policy at module evaluation, not in an effect, and writes nothing durable', () => {
    const source = executable(readFileSync(bootPath, 'utf8'));
    const callAt = source.indexOf('bootWebPlatformPolicy()');
    expect(callAt).toBeGreaterThan(-1);
    expect(callAt).toBeLessThan(source.indexOf('export function PlatformPolicyBoot'));
    expect(source).not.toContain('useEffect');
    // Acceptance scaffolding stays out of the runtime entry point.
    expect(source).not.toContain('bootWebHost');
    expect(source).not.toContain('writeDurable');
    expect(source).not.toContain('replayBatch');
  });

  it('applies the denied default and sets the boot flag on import, with no platform fetch', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('platform fetch must not be called')));
    vi.stubGlobal('fetch', fetchSpy);
    window.localStorage.clear();

    vi.resetModules();
    const policy = await import('@/lib/localFirst/platformPolicy');
    policy.resetWebPlatformPolicyForTests();
    const boot = await import('./PlatformPolicyBoot');
    render(<boot.PlatformPolicyBoot />);

    expect((window as unknown as Record<string, boolean>)[policy.WEB_PLATFORM_POLICY_BOOTED]).toBe(true);
    expect(policy.webPlatformPolicy().allows('synchronize')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
