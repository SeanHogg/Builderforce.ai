import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  EventEmitter: class {
    private listeners: Array<(e: unknown) => void> = [];
    event = (l: (e: unknown) => void) => {
      this.listeners.push(l);
      return { dispose: () => { this.listeners = this.listeners.filter((x) => x !== l); } };
    };
    fire(e: unknown) { for (const l of [...this.listeners]) l(e); }
    dispose() { this.listeners = []; }
  },
}));

const invalidate = vi.hoisted(() => vi.fn());
vi.mock("../bfApi/scopedToken", () => ({ invalidateScopedTokens: invalidate }));

import { createBuilderforceApi, type BuilderforceApiDeps } from "./builderforceApi";

function fakes(over: Partial<BuilderforceApiDeps> = {}) {
  const sessionListeners: Array<(e: { provider: { id: string } }) => void> = [];
  const deps: BuilderforceApiDeps = {
    getBaseUrl: () => "https://api.example",
    getWebUrl: () => "https://web.example",
    isSignedIn: async () => true,
    onDidChangeSessions: ((l: (e: { provider: { id: string } }) => void) => {
      sessionListeners.push(l);
      return { dispose: () => undefined };
    }) as BuilderforceApiDeps["onDidChangeSessions"],
    ...over,
  };
  return { deps, fireSession: (id: string) => sessionListeners.forEach((l) => l({ provider: { id } })) };
}

describe("createBuilderforceApi", () => {
  it("reports version 2 and the configured URLs", () => {
    const api = createBuilderforceApi(fakes().deps);
    expect(api.version).toBe(2);
    expect(api.getBaseUrl()).toBe("https://api.example");
    expect(api.getWebUrl()).toBe("https://web.example");
  });

  it("regression: exports no credential and no sign-in (SEC-G017)", () => {
    const api = createBuilderforceApi(fakes().deps) as unknown as Record<string, unknown>;
    expect(api.getTenantToken).toBeUndefined();
    expect(api.signIn).toBeUndefined();
  });

  it("invalidateScopedToken drops the cache and returns no credential", () => {
    const api = createBuilderforceApi(fakes().deps);
    expect(api.invalidateScopedToken()).toBeUndefined();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("fires onDidChangeSignIn with the stored-key state for the builderforce provider only", async () => {
    let signedIn = true;
    const { deps, fireSession } = fakes({ isSignedIn: async () => signedIn });
    const api = createBuilderforceApi(deps);
    const seen: boolean[] = [];
    api.onDidChangeSignIn((v) => seen.push(v));

    fireSession("github");
    await Promise.resolve();
    expect(seen).toEqual([]);

    fireSession("builderforce");
    await new Promise((r) => setTimeout(r, 0));
    signedIn = false;
    fireSession("builderforce");
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([true, false]);
  });
});
