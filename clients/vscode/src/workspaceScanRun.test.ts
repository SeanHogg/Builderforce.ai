import { describe, expect, it, vi } from "vitest";
import { runWorkspaceScan, type WorkspaceScanPorts } from "./workspaceScanRun";

const ROUTE = { kind: "gateway" } as never;

function ports(over: Partial<WorkspaceScanPorts> = {}): WorkspaceScanPorts & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    root: () => "/ws",
    registerWorkspace: () => calls.push("register"),
    refreshSymbolIndex: async () => { calls.push("index"); },
    policyResolved: async () => undefined,
    key: async () => undefined,
    resolveRoute: async () => ROUTE,
    noModelReason: () => null,
    routeRequiresSignIn: () => true,
    promptNoModel: () => calls.push("prompt"),
    scan: vi.fn(async (_r: string, route: unknown) => { calls.push(route ? "scan:route" : "scan:no-route"); return { grounding: "g", manifests: [], overview: "" }; }),
    setGrounding: () => calls.push("ground"),
    syncAllowed: () => true,
    afterScan: async () => { calls.push("after"); },
    withProgress: async (_t, work) => work(),
    info: () => calls.push("info"),
    error: () => calls.push("error"),
    ...over,
  };
}

describe("runWorkspaceScan (PRD 41 A4)", () => {
  it("scans signed out with a route that needs sign-in: deterministic scan, no overview route, no digest publish", async () => {
    const p = ports();
    await runWorkspaceScan(p, false);
    expect(p.calls).toContain("scan:no-route");
    expect(p.calls).toContain("ground");
    expect(p.calls).not.toContain("after");
  });

  it("scans with no model at all, and prompts only when the person forced it", async () => {
    const quiet = ports({ noModelReason: () => "no_local_model" });
    await runWorkspaceScan(quiet, false);
    expect(quiet.calls).toContain("scan:no-route");
    expect(quiet.calls).not.toContain("prompt");
    const forced = ports({ noModelReason: () => "no_local_model" });
    await runWorkspaceScan(forced, true);
    expect(forced.calls).toContain("prompt");
    expect(forced.calls).toContain("scan:no-route");
  });

  it("passes the route and publishes the digest when signed in with a usable route", async () => {
    const p = ports({ key: async () => "k" });
    await runWorkspaceScan(p, false);
    expect(p.calls).toContain("scan:route");
    expect(p.calls).toContain("after");
  });

  it("a local route needs no key", async () => {
    const p = ports({ routeRequiresSignIn: () => false });
    await runWorkspaceScan(p, false);
    expect(p.calls).toContain("scan:route");
  });

  it("refreshes the index without waiting on policy or route", async () => {
    // Its own root: a never-settling scan must not hold the single-flight slot of the other tests.
    const p = ports({ policyResolved: () => new Promise<void>(() => undefined), root: () => "/never-settles" });
    void runWorkspaceScan(p, false);
    await Promise.resolve();
    expect(p.calls).toEqual(["register", "index"]);
  });

  it("does nothing without a folder", async () => {
    const p = ports({ root: () => undefined });
    await runWorkspaceScan(p, false);
    expect(p.calls).toEqual([]);
  });
});

describe("runWorkspaceScan single flight, sync gate and stale overview", () => {
  it("two concurrent scans of one root run one scan", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const p = ports({ key: async () => "k" });
    (p.scan as ReturnType<typeof vi.fn>).mockImplementation(async () => { await gate; return { grounding: "g", manifests: [], overview: "" }; });
    const a = runWorkspaceScan(p, false);
    const b = runWorkspaceScan(p, false);
    release();
    await Promise.all([a, b]);
    expect(p.scan).toHaveBeenCalledTimes(1);
  });

  it("forced scans during a run queue one trailing forced scan", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const p = ports();
    (p.scan as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { await gate; return { grounding: "g", manifests: [], overview: "" }; });
    const first = runWorkspaceScan(p, false);
    const second = runWorkspaceScan(p, true);
    const third = runWorkspaceScan(p, true);
    release();
    await Promise.all([first, second, third]);
    expect(p.scan).toHaveBeenCalledTimes(2);
    expect((p.scan as ReturnType<typeof vi.fn>).mock.calls[1]?.[2]).toBe(true);
  });

  it("sync revoked: a key alone does not publish the digest", async () => {
    const p = ports({ key: async () => "k", syncAllowed: () => false });
    await runWorkspaceScan(p, false);
    expect(p.calls).toContain("scan:route");
    expect(p.calls).not.toContain("after");
  });

  it("a cached 'skipped / no-model-route' overview is redone once a route is usable", async () => {
    const p = ports({ key: async () => "k" });
    (p.scan as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      grounding: "g", manifests: [], overview: "", overviewStatus: { status: "skipped", reason: "no-model-route" },
    }));
    await runWorkspaceScan(p, false);
    expect(p.scan).toHaveBeenCalledTimes(2);
    expect((p.scan as ReturnType<typeof vi.fn>).mock.calls[1]?.[2]).toBe(true);
  });
});
