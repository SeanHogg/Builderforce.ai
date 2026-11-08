/**
 * G27 — the packaged VSIX's activation-time network-denial self-check
 * (ticket #6369, ROADMAP G27).
 *
 * `deniedNetworkAcceptance.ts` proves the denial with a test-owned boundary
 * (`vi.hoisted` replaces `globalThis.fetch` before `./platformPolicy` binds
 * `nativeFetch`). That never runs in the shipped extension. This module is
 * the composition step: it runs AFTER `bindPlatformPolicy` has installed the
 * guard and `platformPolicyResolved()` has fired, so every fetch it makes goes
 * through the REAL guarded path — the same `globalThis.fetch` the rest of the
 * extension uses.
 *
 * What it proves, once, at activation:
 *   1. a platform request the policy refuses never reaches the network
 *      (the request journal shows zero new `attempted` records for the probe's URL);
 *  2. a non-platform request is NOT refused by the guard (a dead boundary
 *     cannot fake a denial);
 *   3. the result is surfaced on the BuilderForce output channel either way —
 *      a failure is a loud line, never a silent swallow.
 *
 * When the resolved mode permits the platform (a signed-in Hybrid user, or an
 * explicit override), there is nothing to deny: the check reports `skipped`
 * with the reason instead of asserting a denial that is not in force.
 */
import { PlatformAccessDenied } from "@builderforce/local-first";
import { logLine } from "./errorReporter";
import { currentCapabilityInputs } from "./capabilityContext";
import {
  platformInferenceMode,
  platformPolicyResolved,
  platformRequestAccount,
} from "./platformPolicy";

/** Default probe URLs — overridable in tests. */
export const SELF_CHECK_PUSH_URL = "https://api.builderforce.ai/api/sync/v1/push";
export const SELF_CHECK_PROBE_URL = "https://example.com/health";

export interface NetworkDenialSelfCheckReport {
  /** True when the denial held (or the check ran at all against a live guard). */
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

const PASS: Omit<NetworkDenialSelfCheckReport, "attemptedDelta" | "blockedDelta"> = {
  ran: true,
  verified: true,
  skipped: false,
  reason: "platform request refused before the network; guard let the non-platform probe through",
  failures: [],
};

function skippedReport(reason: string): NetworkDenialSelfCheckReport {
  return { ran: true, verified: false, skipped: true, reason, attemptedDelta: 0, blockedDelta: 0, failures: [] };
}

function failedReport(failures: readonly string[], attemptedDelta: number, blockedDelta: number): NetworkDenialSelfCheckReport {
  return { ran: true, verified: false, skipped: false, reason: failures.join("; "), attemptedDelta, blockedDelta, failures };
}

/** The journal records the URL as fetch received it; compare in canonical form so a
 *  re-spelling (case, default port) cannot hide the probe's own attempt. */
function normalizedUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

/**
 * Run the self-check. Await `platformPolicyResolved()` first so the mode-derived
 * snapshot is in force — before it, a signed-in person would read as signed out.
 * Never throws: every outcome is a report, and a failure is logged here.
 */
export async function runNetworkDenialSelfCheck(
  urls: { pushUrl?: string; probeUrl?: string } = {},
): Promise<NetworkDenialSelfCheckReport> {
  const pushUrl = urls.pushUrl ?? SELF_CHECK_PUSH_URL;
  const probeUrl = urls.probeUrl ?? SELF_CHECK_PROBE_URL;
  try {
    await platformPolicyResolved();
  } catch (error) {
    const reason = `policy never resolved: ${String(error)}`;
    logLine(`BuilderForce network-denial self-check: ${reason}`);
    return { ran: false, verified: false, skipped: false, reason, attemptedDelta: 0, blockedDelta: 0, failures: [reason] };
  }

  // The CURRENT policy snapshot permits synchronize — there is no denial in force to
  // verify. Reading the live snapshot (not the cached request-time mode) honors a mode
  // the policy has already applied, even if a later refresh would re-derive it.
  if (currentCapabilityInputs().synchronize) {
    const reason = `mode "${platformInferenceMode()}" currently permits synchronize — nothing to deny`;
    logLine(`BuilderForce network-denial self-check: skipped (${reason})`);
    return skippedReport(reason);
  }

  const before = platformRequestAccount();
  const failures: string[] = [];

  // Probe 1: a platform POST the policy refuses. It must reject with
  // PlatformAccessDenied BEFORE any socket opens — the request journal's
  // `attempted` count must not move.
  try {
    await fetch(pushUrl, { method: "POST", body: "{}" });
    failures.push(`refused platform request to ${pushUrl} was not blocked`);
  } catch (error) {
    if (!(error instanceof PlatformAccessDenied)) {
      failures.push(`platform request failed with ${String(error)} instead of PlatformAccessDenied`);
    }
  }

  // Probe 2: a non-platform URL must NOT be refused by the guard. It may still
  // fail (no network in the test host, example.com down) — only a
  // PlatformAccessDenied here proves the guard over-reached.
  let probeRefused = false;
  try {
    await fetch(probeUrl);
  } catch (error) {
    if (error instanceof PlatformAccessDenied) {
      probeRefused = true;
      failures.push(`non-platform probe ${probeUrl} was refused by the guard`);
    }
  }
  void probeRefused;

  const after = platformRequestAccount();
  // Only attempts at the probe's OWN url count: activation runs beside real, permitted
  // traffic (the sidebar's reads), and that is not the refused request reaching the network.
  const probe = normalizedUrl(pushUrl);
  const attemptedAt = (account: typeof before) =>
    account.recent.filter((record) => record.outcome === "attempted" && normalizedUrl(record.url) === probe).length;
  const attemptedDelta = attemptedAt(after) - attemptedAt(before);
  const blockedDelta = after.blocked - before.blocked;
  if (attemptedDelta !== 0) {
    failures.push(`${attemptedDelta} platform request(s) reached the network while refused`);
  }

  const report = failures.length === 0
    ? { ...PASS, attemptedDelta, blockedDelta }
    : failedReport(failures, attemptedDelta, blockedDelta);

  logLine(
    report.verified
      ? "BuilderForce network-denial self-check: PASS — refused platform requests never reached the network"
      : `BuilderForce network-denial self-check: FAIL — ${report.failures.join("; ")}`,
  );
  return report;
}
