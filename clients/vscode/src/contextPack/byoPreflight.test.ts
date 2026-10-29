/**
 * PRD 35 E7: the editor's BYO preflight. The WHOLE body — the workspace lookup included —
 * races the ~1.5 s deadline (a hung workspace read used to hold the run's start), and the
 * result names where the run lands instead when the same reads know it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getCurrentWorkspace: vi.fn(),
  authed: vi.fn(),
}));
vi.mock("../bfApi", () => api);
vi.mock("../errorReporter", () => ({ logLine: vi.fn() }));

import { byoPreflight } from "./byoPreflight";
import { preflightFallback, unresolvedByoEntries } from "./byoPreflightVerdict";

const secrets = {} as never;
let nextWorkspace = 500;

beforeEach(() => {
  api.getCurrentWorkspace.mockReset();
  api.authed.mockReset();
});

describe("byoPreflight — the deadline covers the whole body", () => {
  it("a workspace lookup that never answers costs the notice, not the run", async () => {
    api.getCurrentWorkspace.mockReturnValue(new Promise(() => undefined));
    const t0 = Date.now();
    expect(await byoPreflight(secrets, 50)).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("names the unresolved account and the ready one the run falls back to", async () => {
    api.getCurrentWorkspace.mockResolvedValue({ id: (nextWorkspace += 1) });
    api.authed.mockImplementation(async (_s: unknown, path: string) => {
      if (path === "/llm/provider-keys") return { details: [{ provider: "anthropic" }, { provider: "openai" }] };
      return { status: path.includes("anthropic") ? "expired" : "ready" };
    });
    expect(await byoPreflight(secrets, 1_000)).toEqual({ byoUnresolved: ["anthropic:expired"], fallback: "your connected openai account" });
  });

  it("a body that throws is no notice", async () => {
    api.getCurrentWorkspace.mockRejectedValue(new Error("offline"));
    expect(await byoPreflight(secrets, 1_000)).toBeUndefined();
  });
});

describe("preflightFallback", () => {
  it("is the first ready account, or unknown when none is", () => {
    expect(preflightFallback([{ provider: "anthropic", status: "expired" }, { provider: "openai", status: "ready" }])).toBe("your connected openai account");
    expect(preflightFallback([{ provider: "anthropic", status: "expired" }])).toBeUndefined();
  });
});

describe("unresolvedByoEntries", () => {
  it("announces a configured credential the server could not resolve without a reason", () => {
    expect(unresolvedByoEntries([{ provider: "anthropic", status: "unavailable" }, { provider: "openai", status: "ready" }])).toEqual(["anthropic:unavailable"]);
  });

  it("does not announce capacity, needs_attention or a missing account", () => {
    expect(unresolvedByoEntries([{ provider: "a", status: "capacity" }, { provider: "b", status: "needs_attention" }, { provider: "c", status: "not_connected" }])).toEqual([]);
  });
});
