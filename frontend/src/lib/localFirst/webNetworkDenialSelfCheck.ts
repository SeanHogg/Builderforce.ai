/**
 * G27 — the web host's boot-time network-denial self-check (ticket #6379,
 * the web twin of the VSIX's `clients/vscode/src/networkDenialSelfCheck.ts`,
 * commit 518dc8a26).
 *
 * `deniedNetworkAcceptance.test.ts` proves the denial from a test-owned
 * boundary (a stubbed `fetch`, an explicit `webPlatformFetch` call made by
 * the test). That never runs on a real page. This module is the composition
 * step: `bootWebPlatformPolicy` runs it AFTER the derived snapshot is applied,
 * so the refused probe goes through the REAL guarded transport —
 * `webPlatformFetch`, the same `createGuardedPlatformFetch` closure the
 * local-first sync surface uses — never a separately constructed guard.
 *
 * What it proves, once, at page boot (production bundles only):
 *   1. a platform request the policy refuses rejects with PlatformAccessDenied
 *      before any socket opens — the request journal gains one `blocked`
 *      record and zero `attempted`;
 *   2. a non-platform request is NOT refused — on the web the guard governs
 *      platform traffic only, and the layout head script passes a third-party
 *      URL straight to the native fetch, so only a PlatformAccessDenied there
 *      proves the gate over-reached;
 *   3. the outcome is on the console either way — a failure is a loud line,
 *      never a silent swallow.
 *
 * When the applied snapshot permits synchronize (a signed-in person with the
 * sync grant, an explicit override), there is no denial in force: the check
 * reports `skipped` with its reason instead of asserting a denial that does
 * not exist. Unlike the VSIX there is no async policy resolution to await —
 * `bootWebPlatformPolicy` applies the snapshot synchronously before this
 * runs, and the skip reads that live snapshot.
 *
 * The durable denied-host proof (one local record, reopened, replayed
 * locally) stays the node/test path in `./bootWebHost`; this is the
 * production page's activation-time acceptance, like the VSIX's.
 */
import { PlatformAccessDenied } from '@builderforce/local-first';
import { API_ORIGIN } from '../apiOrigin';
import { webPlatformFetch, webPlatformPolicy, webPlatformRequestAccount } from './platformPolicy';

/** Default probe URLs — overridable in tests. */
export const SELF_CHECK_PUSH_URL = `${API_ORIGIN}/api/sync/v1/push`;
export const SELF_CHECK_PROBE_URL = 'https://example.com/health';

export interface WebNetworkDenialSelfCheckReport {
  /** True when the check ran against the live guard (false only on an unexpected crash). */
  readonly ran: boolean;
  /** True when the policy denied the platform and the guard enforced it. */
  readonly verified: boolean;
  /** True when the current snapshot permits synchronize, so no denial was asserted. */
  readonly skipped: boolean;
  readonly reason: string;
  readonly attemptedDelta: number;
  readonly blockedDelta: number;
  readonly failures: readonly string[];
}

const PASS: Omit<WebNetworkDenialSelfCheckReport, 'attemptedDelta' | 'blockedDelta'> = {
  ran: true,
  verified: true,
  skipped: false,
  reason: 'platform request refused before the network; non-platform probe not refused',
  failures: [],
};

function skippedReport(reason: string): WebNetworkDenialSelfCheckReport {
  return { ran: true, verified: false, skipped: true, reason, attemptedDelta: 0, blockedDelta: 0, failures: [] };
}

function failedReport(failures: readonly string[], attemptedDelta: number, blockedDelta: number): WebNetworkDenialSelfCheckReport {
  return { ran: true, verified: false, skipped: false, reason: failures.join('; '), attemptedDelta, blockedDelta, failures };
}

/**
 * Run the self-check against the REAL guarded fetch installed by
 * `./platformPolicy`. Never throws: every outcome is a report, and a failure
 * is logged here — on the console, not swallowed.
 */
export async function runWebNetworkDenialSelfCheck(
  urls: { pushUrl?: string; probeUrl?: string } = {},
): Promise<WebNetworkDenialSelfCheckReport> {
  const pushUrl = urls.pushUrl ?? SELF_CHECK_PUSH_URL;
  const probeUrl = urls.probeUrl ?? SELF_CHECK_PROBE_URL;

  // The CURRENT snapshot permits synchronize — there is no denial in force to
  // verify. Read the live policy (the snapshot boot applied), the web twin of
  // the VSIX reading its mode-derived snapshot.
  if (webPlatformPolicy().allows('synchronize')) {
    const reason = 'the applied policy currently permits synchronize — nothing to deny';
    console.warn(`BuilderForce web network-denial self-check: skipped (${reason})`);
    return skippedReport(reason);
  }

  const before = webPlatformRequestAccount();
  const failures: string[] = [];

  // Probe 1: a platform sync push the policy refuses. It must reject with
  // PlatformAccessDenied BEFORE any socket opens — through the real
  // webPlatformFetch guard, which records the block in the request journal.
  try {
    await webPlatformFetch(pushUrl, { method: 'POST', body: '{}' });
    failures.push(`refused platform request to ${pushUrl} was not blocked`);
  } catch (error) {
    if (!(error instanceof PlatformAccessDenied)) {
      failures.push(`platform request failed with ${String(error)} instead of PlatformAccessDenied`);
    }
  }

  // Probe 2: a non-platform URL must NOT be refused. The web guard governs
  // platform traffic only and the layout head script passes third-party URLs
  // straight to the native fetch, so this exercises the page's real fetch
  // path. It may still fail for ordinary network reasons — only a
  // PlatformAccessDenied here proves the gate over-reached.
  try {
    await fetch(probeUrl);
  } catch (error) {
    if (error instanceof PlatformAccessDenied) {
      failures.push(`non-platform probe ${probeUrl} was refused by the guard`);
    }
  }

  const after = webPlatformRequestAccount();
  const attemptedDelta = after.attempted - before.attempted;
  const blockedDelta = after.blocked - before.blocked;
  if (attemptedDelta !== 0) {
    failures.push(`${attemptedDelta} platform request(s) reached the network while refused`);
  }

  const report = failures.length === 0
    ? { ...PASS, attemptedDelta, blockedDelta }
    : failedReport(failures, attemptedDelta, blockedDelta);

  if (report.verified) {
    console.info('BuilderForce web network-denial self-check: PASS — refused platform requests never reached the network');
  } else {
    console.error(`BuilderForce web network-denial self-check: FAIL — ${report.failures.join('; ') || report.reason}`);
  }
  return report;
}

let bootRun: Promise<WebNetworkDenialSelfCheckReport> | null = null;

/**
 * The boot's call site — runs the check at most once per page. The runner
 * never rejects; the boot still attaches a catch so a regression in THIS
 * module surfaces loudly on the console instead of as an unhandled rejection.
 */
export function runWebNetworkDenialSelfCheckOnce(): Promise<WebNetworkDenialSelfCheckReport> {
  bootRun ??= runWebNetworkDenialSelfCheck();
  return bootRun;
}

/** The in-flight/completed boot run — null before the first boot. For tests and diagnostics. */
export function webNetworkDenialSelfCheckLastRun(): Promise<WebNetworkDenialSelfCheckReport> | null {
  return bootRun;
}

/** Test hook: re-arm the once-per-page runner. */
export function resetWebNetworkDenialSelfCheckForTests(): void {
  bootRun = null;
}
