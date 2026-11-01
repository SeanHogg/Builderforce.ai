/**
 * G27 — activation-time composition of the network-denial self-check
 * (ticket #6369).
 *
 * Unlike `deniedNetworkAcceptance.test.ts` (which owns `globalThis.fetch` in a
 * `vi.hoisted` boundary), this test drives the REAL activation composition: the
 * same `bindPlatformPolicy` + `runNetworkDenialSelfCheck` pair `extension.ts`
 * wires, with no fetch replacement. `nativeFetch` is bound at module-eval and
 * the guard wraps the real global fetch — so a pass here is a pass on the actual
 * guarded path, not a mocked re-assertion.
 *
 * `platformPolicyResolved()` fires inside `runNetworkDenialSelfCheck` after the
 * first policy refresh; here the policy starts refused (local-only, signed out),
 * so the push URL is refused and the non-platform probe is the only fetch that
 * can reach the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_FIRST_POLICY } from "@builderforce/local-first";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({ get: (_key: string, fallback?: unknown) => fallback }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: {},
  commands: { executeCommand: vi.fn() },
  l10n: { t: (message: string) => message },
}));

// Stub the log surface so the self-check's module does not drag in `./errorReporter`'s
// whole chain (`bfApi` → `bfApi/session.ts` instantiates `vscode.EventEmitter` at module
// scope). We assert on the report, not the log line.
vi.mock("./errorReporter", () => ({ logLine: vi.fn() }));

import { bindPlatformPolicy, platformPolicy, platformPolicyResolved, platformRequestAccount } from "./platformPolicy";
import {
  SELF_CHECK_PROBE_URL,
  SELF_CHECK_PUSH_URL,
  runNetworkDenialSelfCheck,
} from "./networkDenialSelfCheck";

/** Count only the attempts the self-check itself made (the real network may see the probe). */
function accountDelta(before: ReturnType<typeof platformRequestAccount>) {
  const after = platformRequestAccount();
  return { attempted: after.attempted - before.attempted, blocked: after.blocked - before.blocked };
}

describe("G27 activation-time network-denial self-check", () => {
  let subscriptions: Array<{ dispose(): void }>;
  let restoreFetch: (() => void) | undefined;

  beforeEach(() => {
    subscriptions = [];
    platformPolicy().set({ ...LOCAL_FIRST_POLICY });
  });

  afterEach(() => {
    while (subscriptions.length > 0) subscriptions.pop()?.dispose();
    restoreFetch?.();
    restoreFetch = undefined;
    platformPolicy().set({ ...LOCAL_FIRST_POLICY });
  });

  it("verifies a refused platform request never reaches the network on the real guarded path", async () => {
    // Same composition extension.ts uses: bind the guard, then self-check.
    bindPlatformPolicy({ subscriptions } as never);

    const before = platformRequestAccount();
    const report = await runNetworkDenialSelfCheck();
    const delta = accountDelta(before);

    expect(report.ran).toBe(true);
    expect(report.skipped).toBe(false);
    expect(report.verified).toBe(true);
    expect(report.failures).toEqual([]);
    // The refused push added a BLOCKED journal record and zero ATTEMPTED ones —
    // the socket never opened. The non-platform probe does not touch the journal.
    expect(delta.attempted).toBe(0);
    expect(delta.blocked).toBe(1);
  });

  it("skips (does not assert a denial) when the resolved mode permits synchronize", async () => {
    bindPlatformPolicy({ subscriptions } as never);
    // Let the first refresh land, THEN set the permitted snapshot: a set before resolution
    // would be overwritten by the in-flight refresh's derived (refused) snapshot.
    await platformPolicyResolved();
    platformPolicy().set({ ...LOCAL_FIRST_POLICY, synchronize: true });

    const before = platformRequestAccount();
    const report = await runNetworkDenialSelfCheck();

    expect(report.ran).toBe(true);
    expect(report.skipped).toBe(true);
    expect(report.verified).toBe(false);
    expect(report.reason).toMatch(/permits synchronize/);
    expect(accountDelta(before)).toEqual({ attempted: 0, blocked: 0 });
  });

  it("fails loudly when the guard over-reaches and refuses a non-platform URL", async () => {
    bindPlatformPolicy({ subscriptions } as never);
    // Wrap the INSTALLED guard so EVERY origin reads as platform (install after
    // bindPlatformPolicy, which just replaced globalThis.fetch): the non-platform probe
    // must now be refused by the guard, which the self-check must surface.
    const installed = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw);
      return installed(
        url.origin === "https://api.builderforce.ai" ? input : new Request(SELF_CHECK_PUSH_URL, { method: "POST" }),
        init,
      );
    }) as typeof fetch;
    restoreFetch = () => {
      if (globalThis.fetch !== installed) globalThis.fetch = installed;
    };
    const before = platformRequestAccount();
    const report = await runNetworkDenialSelfCheck();
    const delta = accountDelta(before);

    expect(report.ran).toBe(true);
    expect(report.verified).toBe(false);
    expect(report.failures.join(" ")).toMatch(/non-platform probe/);
    // The misrouted probe also adds a blocked journal record; still nothing attempted.
    expect(delta.attempted).toBe(0);
  });
});
