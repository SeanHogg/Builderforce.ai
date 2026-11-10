// @vitest-environment jsdom
/**
 * G27 — boot-time composition of the web network-denial self-check
 * (ticket #6379, the web twin of the VSIX's
 * `clients/vscode/src/networkDenialSelfCheck.test.ts`).
 *
 * `deniedNetworkAcceptance.test.ts` drives the gate from a test-owned
 * boundary: it calls `webPlatformFetch` itself, against a stubbed fetch.
 * This file drives the REAL boot composition instead — the same
 * `bootWebPlatformPolicy` + self-check pair `components/PlatformPolicyBoot`
 * wires at page boot — with no second guard and no mocked policy module.
 * `bootWebPlatformPolicy` fires the self-check only when
 * `NODE_ENV === 'production'` (Next inlines it in shipped bundles; vitest
 * runs as `test`), so these tests flip the env var for the boot call and
 * restore it after.
 *
 * The refused push probe goes through the real `webPlatformFetch` guard: a
 * pass here is a pass on the actual guarded path, not a mocked re-assertion.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformAccessDenied } from '@builderforce/local-first';
import { API_ORIGIN } from '../apiOrigin';
import {
  bootWebPlatformPolicy,
  resetWebPlatformPolicyForTests,
  webPlatformFetch,
  webPlatformPolicy,
  webPlatformRequestAccount,
} from './platformPolicy';
import {
  resetWebNetworkDenialSelfCheckForTests,
  runWebNetworkDenialSelfCheck,
  webNetworkDenialSelfCheckLastRun,
} from './webNetworkDenialSelfCheck';

const here = dirname(fileURLToPath(import.meta.url));
const PREVIOUS_NODE_ENV = process.env.NODE_ENV;

const SELF_CHECK_PUSH_URL = `${API_ORIGIN}/api/sync/v1/push`;

function bootInProduction(): void {
  vi.stubEnv('NODE_ENV', 'production');
  try {
    bootWebPlatformPolicy();
  } finally {
    if (PREVIOUS_NODE_ENV === undefined) vi.unstubAllEnvs();
    else vi.stubEnv('NODE_ENV', PREVIOUS_NODE_ENV);
  }
}

describe('G27 boot-time web network-denial self-check', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetWebPlatformPolicyForTests();
    resetWebNetworkDenialSelfCheckForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetWebPlatformPolicyForTests();
    resetWebNetworkDenialSelfCheckForTests();
  });

  it('verifies a refused platform request never reaches the network on the real guarded path at boot', async () => {
    const native = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', native);

    bootInProduction();
    const report = await webNetworkDenialSelfCheckLastRun();

    expect(report).not.toBeNull();
    expect(report!.ran).toBe(true);
    expect(report!.skipped).toBe(false);
    expect(report!.verified).toBe(true);
    expect(report!.failures).toEqual([]);
    // The refused push was the only guarded call: one BLOCKED journal record,
    // zero ATTEMPTED — the socket never opened. The non-platform probe does
    // not touch the journal.
    expect(webPlatformRequestAccount()).toMatchObject({ attempted: 0, blocked: 1 });
    expect(native).toHaveBeenCalledTimes(1);
    expect(native.mock.calls[0]?.[0]).toBe('https://example.com/health');
    // The boot itself must not have routed the push through the page fetch.
    expect(native.mock.calls.some(([input]) => String(input).includes('/api/sync'))).toBe(false);
  });

  it('skips (does not assert a denial) when the applied policy permits synchronize', async () => {
    // Signed out = Local only, which refuses synchronize. Signed in and undecided =
    // Hybrid, which permits it by default (chat #70776) — no stored grant needed.
    window.localStorage.setItem('bf_web_token', 'present');
    const native = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', native);

    bootInProduction();
    const report = await webNetworkDenialSelfCheckLastRun();

    expect(report).not.toBeNull();
    expect(report!.ran).toBe(true);
    expect(report!.skipped).toBe(true);
    expect(report!.verified).toBe(false);
    expect(report!.reason).toMatch(/permits synchronize/);
    expect(webPlatformRequestAccount()).toMatchObject({ attempted: 0, blocked: 0 });
    expect(native).not.toHaveBeenCalled();
  });

  it('fails loudly when the guard over-reaches and refuses a non-platform URL', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The page's real fetch path now refuses the probe — a dead-boundary guard
    // faking a denial. The self-check must surface it as a failure.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url === 'https://example.com/health') throw new PlatformAccessDenied('connected-feature');
        return new Response('{}', { status: 200 });
      }),
    );

    const report = await runWebNetworkDenialSelfCheck();

    expect(report.ran).toBe(true);
    expect(report.verified).toBe(false);
    expect(report.failures.join(' ')).toMatch(/non-platform probe/);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/network-denial self-check: FAIL/));
    // Still nothing attempted; the misrouted probe added no platform journal row.
    expect(report.attemptedDelta).toBe(0);
  });

  it('keeps the boot delegation intact: the durable-write host still delegates the shared primitive', () => {
    const boot = readFileSync(resolve(here, 'bootWebHost.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const policy = readFileSync(resolve(here, 'platformPolicy.ts'), 'utf8');
    expect(boot).toContain('bootDeniedHost(');
    expect(boot).not.toContain('createGuardedPlatformFetch');
    // The boot-time acceptance is the sibling self-check module, fired by the
    // policy boot after the snapshot is applied.
    expect(policy).toContain('runWebNetworkDenialSelfCheckOnce()');
    expect(policy.indexOf('applyPolicy();')).toBeLessThan(policy.indexOf('runWebNetworkDenialSelfCheckOnce()'));
  });
});
