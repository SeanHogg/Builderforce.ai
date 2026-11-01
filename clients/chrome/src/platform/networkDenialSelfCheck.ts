/**
 * Rovr's PACKAGED network-denial self-check (gap ticket #6378) — the Chrome
 * extension's mirror of the VSIX's `networkDenialSelfCheck.ts`.
 *
 * `deniedNetworkAcceptance.test.ts` proves the denial with a test-owned fetch
 * stub. That never runs in the shipped extension. This module is the
 * composition step: it runs AFTER `createRovrGuardedFetch` has installed the
 * guard and `policy.ready()` has resolved, so every probe it makes goes through
 * the REAL guarded fetchImpl the boot bound — not a freshly constructed guard,
 * not a captured global. Rovr does not override `globalThis.fetch`; the guard
 * is an injected `fetchImpl`, so the self-check takes it in.
 *
 * What it proves, once, at boot:
 *   1. a platform request the policy refuses never reaches the network (the
 *      guard's request account shows zero new `attempted` records);
 *   2. a non-platform request is NOT refused by the guard (a dead or
 *      over-reaching boundary cannot fake a denial);
 *   3. the result is surfaced on the extension log either way — a failure is
 *      a loud line, never a silent swallow.
 *
 * When the resolved mode permits the platform (a signed-in Hybrid user, or an
 * explicit override), there is nothing to deny: the check reports `skipped`
 * with the reason instead of asserting a denial that is not in force.
 */
import { PlatformAccessDenied } from '@builderforce/local-first';
import { DEFAULT_BASE_URL } from '../config';
import type { RovrPlatformPolicy } from './policy';

/** A platform POST the shared route table classifies as `synchronize`
 *  (the local-first `HTTP_SYNC_PUSH_PATH`). */
export const SELF_CHECK_PUSH_URL = `${DEFAULT_BASE_URL}/api/sync/v1/push`;
export const SELF_CHECK_PROBE_URL = 'https://example.com/health';

/** The request-account counter the guard's `onRequest` callback increments. */
export interface NetworkDenialAccount {
  attempted: number;
  blocked: number;
}

export interface NetworkDenialSelfCheckReport {
  /** True when the check ran at all against a live guard (or skipped by policy). */
  readonly ran: boolean;
  /** True when the policy denied the platform and the guard enforced it. */
  readonly verified: boolean;
  /** True when the current mode permits the platform, so denial was not asserted. */
  readonly skipped: boolean;
  readonly reason: string;
  readonly attemptedDelta: number;
  readonly blockedDelta: number;
  readonly failures: readonly string[];
}

const PASS: Omit<NetworkDenialSelfCheckReport, 'attemptedDelta' | 'blockedDelta'> = {
  ran: true,
  verified: true,
  skipped: false,
  reason: 'platform request refused before the network; guard let the non-platform probe through',
  failures: [],
};

function skippedReport(reason: string): NetworkDenialSelfCheckReport {
  return { ran: true, verified: false, skipped: true, reason, attemptedDelta: 0, blockedDelta: 0, failures: [] };
}

function failedReport(failures: readonly string[], attemptedDelta: number, blockedDelta: number): NetworkDenialSelfCheckReport {
  return { ran: true, verified: false, skipped: false, reason: failures.join('; '), attemptedDelta, blockedDelta, failures };
}

/**
 * Run the self-check. Await `policy.ready()` first so the mode-derived snapshot
 * is in force — before it, a signed-in person would read as signed out.
 * Never throws: every outcome is a report, and a failure is logged here.
 */
export async function runNetworkDenialSelfCheck(options: {
  /** The guarded fetch installed at boot — the real guarded path, not a fresh guard. */
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  /** The live platform policy; its snapshot is read synchronously after `ready()`. */
  policy: RovrPlatformPolicy;
  /** The request-account counter the boot's `onRequest` callback increments. */
  account: NetworkDenialAccount;
  pushUrl?: string;
  probeUrl?: string;
  log?: (line: string) => void;
}): Promise<NetworkDenialSelfCheckReport> {
  const { fetchImpl, policy, account } = options;
  const pushUrl = options.pushUrl ?? SELF_CHECK_PUSH_URL;
  const probeUrl = options.probeUrl ?? SELF_CHECK_PROBE_URL;
  const log = options.log ?? ((line: string) => console.warn(line));
  try {
    await policy.ready();
  } catch (error) {
    const reason = `policy never resolved: ${String(error)}`;
    log(`Rovr network-denial self-check: ${reason}`);
    return { ran: false, verified: false, skipped: false, reason, attemptedDelta: 0, blockedDelta: 0, failures: [reason] };
  }

  // The CURRENT policy snapshot permits synchronize — there is no denial in force to
  // verify. Reading the live snapshot honors a mode the policy has already applied,
  // even if a later refresh would re-derive it.
  if (policy.allows('synchronize')) {
    const reason = `mode "${policy.inferenceMode().mode}" currently permits synchronize — nothing to deny`;
    log(`Rovr network-denial self-check: skipped (${reason})`);
    return skippedReport(reason);
  }

  const before = { attempted: account.attempted, blocked: account.blocked };
  const failures: string[] = [];

  // Probe 1: a platform POST the policy refuses. It must reject with
  // PlatformAccessDenied BEFORE any socket opens — the account's `attempted`
  // count must not move.
  try {
    await fetchImpl(pushUrl, { method: 'POST', body: '{}' });
    failures.push(`refused platform request to ${pushUrl} was not blocked`);
  } catch (error) {
    if (!(error instanceof PlatformAccessDenied)) {
      failures.push(`platform request failed with ${String(error)} instead of PlatformAccessDenied`);
    }
  }

  // Probe 2: a non-platform URL must NOT be refused by the guard. It may still
  // fail (no network in the test host, example.com down) — only a
  // PlatformAccessDenied here proves the guard over-reached.
  try {
    await fetchImpl(probeUrl);
  } catch (error) {
    if (error instanceof PlatformAccessDenied) {
      failures.push(`non-platform probe ${probeUrl} was refused by the guard`);
    }
  }

  const attemptedDelta = account.attempted - before.attempted;
  const blockedDelta = account.blocked - before.blocked;
  if (attemptedDelta !== 0) {
    failures.push(`${attemptedDelta} platform request(s) reached the network while refused`);
  }

  const report = failures.length === 0
    ? { ...PASS, attemptedDelta, blockedDelta }
    : failedReport(failures, attemptedDelta, blockedDelta);

  log(
    report.verified
      ? 'Rovr network-denial self-check: PASS — refused platform requests never reached the network'
      : `Rovr network-denial self-check: FAIL — ${report.failures.join('; ')}`,
  );
  return report;
}
