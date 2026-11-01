/**
 * Gap #6378 — packaged network-denial self-check for the Rovr Chrome extension.
 *
 * Unlike `deniedNetworkAcceptance.test.ts` (which owns `globalThis.fetch` in a
 * `vi.stubGlobal` boundary), this test drives the REAL boot composition: the same
 * `createRovrGuardedFetch` + `createRovrPlatformPolicy` + `runNetworkDenialSelfCheck`
 * triple `serviceWorker.ts` and `panelServices.ts` wire, with NO fetch replacement
 * before module load. `fetchImpl` is bound at module-eval and the guard wraps the
 * real global fetch — so a pass here is a pass on the actual guarded path.
 *
 * The self-check probes through the INSTALLED `fetchImpl` (Rovr does not override
 * `globalThis.fetch`), so the over-reach case wraps that installed fetchImpl rather
 * than a global.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_FIRST_POLICY } from '@builderforce/local-first';
import { createRovrGuardedFetch } from './guardedFetch';
import { createMemoryKeyValue } from './keyValue';
import {
  SELF_CHECK_PUSH_URL,
  runNetworkDenialSelfCheck,
  type NetworkDenialAccount,
} from './networkDenialSelfCheck';
import { createRovrPlatformPolicy, type RovrPlatformPolicy } from './policy';

/** The exact composition `serviceWorker.ts` uses: one policy, one guarded fetch, one account. */
function composeBoot(): {
  policy: RovrPlatformPolicy;
  fetchImpl: ReturnType<typeof createRovrGuardedFetch>;
  account: NetworkDenialAccount;
} {
  const policy = createRovrPlatformPolicy(createMemoryKeyValue());
  const account: NetworkDenialAccount = { attempted: 0, blocked: 0 };
  const fetchImpl = createRovrGuardedFetch({
    policy,
    onRequest: (record) => {
      account[record.outcome] += 1;
    },
  });
  return { policy, fetchImpl, account };
}

describe('gap #6378 packaged network-denial self-check', () => {
  let restoreFetch: (() => void) | undefined;

  beforeEach(() => {
    restoreFetch = undefined;
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('verifies a refused platform request never reaches the network on the real guarded path', async () => {
    const { policy, fetchImpl, account } = composeBoot();
    await policy.ready();
    expect(policy.allows('synchronize')).toBe(false);

    const report = await runNetworkDenialSelfCheck({ fetchImpl, policy, account });

    expect(report.ran).toBe(true);
    expect(report.skipped).toBe(false);
    expect(report.verified).toBe(true);
    expect(report.failures).toEqual([]);
    // The refused push added a BLOCKED account record and zero ATTEMPTED ones —
    // the socket never opened. The non-platform probe does not touch the account.
    expect(report.attemptedDelta).toBe(0);
    expect(report.blockedDelta).toBe(1);
  });

  it('skips (does not assert a denial) when the resolved mode permits synchronize', async () => {
    const { policy, fetchImpl, account } = composeBoot();
    // Let the first refresh land, THEN set the permitted snapshot: a set before resolution
    // would be overwritten by the in-flight refresh's derived (refused) snapshot.
    await policy.ready();
    policy.set({ ...LOCAL_FIRST_POLICY, synchronize: true });

    const report = await runNetworkDenialSelfCheck({ fetchImpl, policy, account });

    expect(report.ran).toBe(true);
    expect(report.skipped).toBe(true);
    expect(report.verified).toBe(false);
    expect(report.reason).toMatch(/permits synchronize/);
    expect(report.attemptedDelta).toBe(0);
    expect(report.blockedDelta).toBe(0);
  });

  it('fails loudly when the guard over-reaches and refuses a non-platform URL', async () => {
    const { policy, account } = composeBoot();
    await policy.ready();
    const installed = createRovrGuardedFetch({ policy });
    // Wrap the INSTALLED guard so EVERY origin reads as platform: the non-platform
    // probe must now be refused by the guard, which the self-check must surface.
    const fetchImpl = (input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      return installed(
        url.origin === 'https://builderforce.ai' || url.origin === 'https://api.builderforce.ai'
          ? input
          : SELF_CHECK_PUSH_URL,
        url.origin === 'https://builderforce.ai' || url.origin === 'https://api.builderforce.ai' ? init : { method: 'POST' },
      );
    };

    const report = await runNetworkDenialSelfCheck({ fetchImpl, policy, account });

    expect(report.ran).toBe(true);
    expect(report.verified).toBe(false);
    expect(report.failures.join(' ')).toMatch(/non-platform probe/);
    // The misrouted probe also adds a blocked account record; still nothing attempted.
    expect(report.attemptedDelta).toBe(0);
  });
});
