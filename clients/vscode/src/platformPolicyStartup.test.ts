/**
 * THE STARTUP RACE: the signed-in fact is an async SecretStorage read, so a policy
 * computed before it lands would refuse a signed-in person as Local only — and the
 * heartbeat / assigned-work poll started at activation would be refused with it. The
 * policy resolves only after the read (`platformPolicyResolved`), and the first snapshot
 * it applies is the signed-in one. Its own file: the policy is a module singleton, and
 * this has to observe it from a cold start.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: () => undefined,
      inspect: (key: string) => ({ key }),
      update: async () => undefined,
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  ConfigurationTarget: { Global: 1 },
}));

import { bindPlatformPolicy, platformPolicy, platformPolicyResolved } from "./platformPolicy";
import { inferenceModeState } from "./inferenceModeSetting";

describe("platform policy at activation", () => {
  it("resolves only after the signed-in read, straight onto Hybrid for a signed-in person", async () => {
    let releaseSecret: (key: string) => void = () => undefined;
    const secret = new Promise<string>((resolve) => {
      releaseSecret = resolve;
    });
    const context = {
      subscriptions: [] as Array<{ dispose(): void }>,
      secrets: { get: () => secret, onDidChange: () => ({ dispose() {} }) },
    };
    const seen: boolean[] = [];
    platformPolicy().subscribe((snapshot) => seen.push(snapshot.gatewayInference));
    let resolvedEarly = false;
    void platformPolicyResolved().then(() => {
      resolvedEarly = true;
    });

    const bound = bindPlatformPolicy(context as never, "builderforce.apiKey");
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The read has not landed: nothing resolved, nothing computed from a signed-out guess.
    expect(resolvedEarly).toBe(false);
    expect(platformPolicy().allows("connected-feature")).toBe(false);

    releaseSecret("bfk_test");
    await bound;
    expect(inferenceModeState()).toEqual({ mode: "hybrid", chosen: false, signedIn: true });
    expect(platformPolicy().allows("gateway-inference")).toBe(true);
    expect(platformPolicy().allows("connected-feature")).toBe(true);
    // Never a Local-only snapshot in between: the first change is the signed-in one.
    expect(seen[0]).toBe(true);
    for (const sub of context.subscriptions) sub.dispose();
  });
});
