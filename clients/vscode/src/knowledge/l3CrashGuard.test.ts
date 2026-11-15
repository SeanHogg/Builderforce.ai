import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  sha: "aaa" as string | undefined,
  runs: 0,
  hang: false,
  fail: undefined as Error | undefined,
}));
const { memento } = vi.hoisted(() => ({
  memento: {
    get: <T>(k: string) => h.store.get(k) as T | undefined,
    update: async (k: string, v: unknown) => { if (v === undefined) h.store.delete(k); else h.store.set(k, v); },
  },
}));
vi.mock("./knowledgeSyncStatus", () => ({ hostMemento: () => memento }));
vi.mock("@builderforce/agent-tools/node-git-history", () => ({ recentCommits: vi.fn(async () => (h.sha ? [{ sha: h.sha, paths: [] }] : [])) }));
vi.mock("../localCapabilities", () => ({ buildLocalCapabilityProvider: () => ({}) }));
vi.mock("@builderforce/repo-map", () => ({ repoMapPort: {} }));
vi.mock("./l3Worker", () => ({
  runL3InWorker: vi.fn(async () => {
    h.runs += 1;
    // the host dies mid-pass: the worker's answer never comes, and nothing after this line runs in that "session"
    if (h.hang) return new Promise(() => undefined);
    if (h.fail) throw h.fail;
    return { extracted: [], snapshot: { tools: [{ status: "complete" }] }, edges: 1 };
  }),
}));
vi.mock("@builderforce/agent-tools/knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@builderforce/agent-tools/knowledge")>()),
  workspaceAnalysisKey: async () => `key-${h.sha ?? "none"}`,
}));

import type { PlanDetail } from "@seanhogg/builderforce-memory/knowledge";
import {
  clearL3InFlight, forgetL3Guards, l3BlockedFor, l3CrashGuard, l3InFlightKey, L3_QUARANTINE_MS, l3QuarantineKey, L3Quarantined, type L3QuarantineRecord,
} from "./l3CrashGuard";
import { L3_IDLE_MAINS_MS, realClock } from "./indexBudget";
import type { IndexPlan } from "./indexReconcile";
import { PRIORITY } from "./indexScheduler";
import { l3StateOf } from "./l3Persist";
import { forgetSharedAnalyses, sharedAnalysis } from "./l3SharedAnalysis";
import { RootIndexer, type IndexRootPorts } from "./rootIndexer";

/** A new extension-host session over the same workspace state. */
const restart = (): void => { forgetL3Guards(); forgetSharedAnalyses(); };

beforeEach(() => {
  h.store.clear();
  h.sha = "aaa";
  h.runs = 0;
  h.hang = false;
  h.fail = undefined;
  restart();
});

describe("L3 crash guard — the in-flight sentinel", () => {
  it("is persisted (awaited) before the pass starts and cleared when it completes", async () => {
    const guard = l3CrashGuard("r", { memento: () => memento, now: () => 5 });
    await guard.begin("aaa");
    expect(h.store.get(l3InFlightKey("r"))).toEqual({ sha: "aaa", startedAt: 5 });
    await guard.end("aaa");
    expect(h.store.has(l3InFlightKey("r"))).toBe(false);
    expect(await l3CrashGuard("r", { memento: () => memento }).blocked("aaa")).toBeUndefined(); // the next session finds nothing
  });

  it("is cleared on a caught failure too; only a permanent one (heap limit, over budget) quarantines the tree", async () => {
    const guard = l3CrashGuard("r", { memento: () => memento });
    await guard.begin("aaa");
    await guard.end("aaa", new Error("spawn failed"));
    expect(h.store.has(l3InFlightKey("r"))).toBe(false);
    expect(h.store.has(l3QuarantineKey("r"))).toBe(false);
    await guard.begin("aaa");
    await guard.end("aaa", Object.assign(new Error("l3_result_over_budget: too big"), { code: "l3_result_over_budget" }));
    expect(h.store.has(l3InFlightKey("r"))).toBe(false);
    expect(h.store.get(l3QuarantineKey("r"))).toMatchObject({ sha: "aaa", reason: "permanent-failure" });
    await expect(guard.begin("aaa")).rejects.toBeInstanceOf(L3Quarantined);
  });

  it("stays while any pass of the root runs (two askers of different scopes)", async () => {
    const guard = l3CrashGuard("r", { memento: () => memento });
    await guard.begin("aaa");
    await guard.begin("aaa");
    await guard.end("aaa");
    expect(h.store.has(l3InFlightKey("r"))).toBe(true);
    await guard.end("aaa");
    expect(h.store.has(l3InFlightKey("r"))).toBe(false);
  });
});

describe("L3 crash guard — a sentinel left by a host that died", () => {
  it("git root: quarantines that sha across further restarts, logs ONE line per session, and lifts when the commit moves", async () => {
    await l3CrashGuard("r", { memento: () => memento, now: () => 100 }).begin("aaa"); // the host dies here
    const log = vi.fn();
    const next = l3CrashGuard("r", { memento: () => memento, now: () => 200, log });
    expect(await next.blocked("aaa")).toMatch(/extension host stopped during the last L3 pass/);
    expect(await next.blocked("aaa")).toBeDefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatch(/^\[knowledge\] L3 analyzers skipped for r: .*until the commit moves from aaa/);
    expect(h.store.has(l3InFlightKey("r"))).toBe(false);
    expect(h.store.get(l3QuarantineKey("r"))).toMatchObject({ sha: "aaa", reason: "host-died", at: 100 } satisfies Partial<L3QuarantineRecord>);
    // yet another restart: still held, with no new sentinel needed
    expect(await l3CrashGuard("r", { memento: () => memento }).blocked("aaa")).toBeDefined();
    // the commit moved: lifted, and forgotten
    expect(await l3CrashGuard("r", { memento: () => memento }).blocked("bbb")).toBeUndefined();
    expect(h.store.has(l3QuarantineKey("r"))).toBe(false);
  });

  it("a root git cannot name: quarantined for the window, then lifted", async () => {
    await l3CrashGuard("r", { memento: () => memento, now: () => 1_000 }).begin(null); // the host dies here
    let now = 2_000;
    const next = l3CrashGuard("r", { memento: () => memento, now: () => now });
    expect(await next.blocked(null)).toMatch(/until \d{4}-/);
    now = 2_000 + L3_QUARANTINE_MS - 1;
    expect(await next.blocked(null)).toBeDefined();
    now = 2_000 + L3_QUARANTINE_MS;
    expect(await next.blocked(null)).toBeUndefined();
  });
});

describe("L3 crash guard at the door to the worker (sharedAnalysis)", () => {
  // regression: the host died mid-pass every ~13 min; nothing was recorded (the process was gone before any catch ran), the
  // workspace root was not a git repository (no sha guard), so every restart ran the same pass again and crashed again.
  it("regression: a pass whose host died is not re-run on the next start — git root or not", async () => {
    for (const sha of ["aaa", undefined]) {
      h.store.clear();
      h.sha = sha;
      h.runs = 0;
      restart();
      h.hang = true;
      void sharedAnalysis({ folderPath: "/ws", rootId: "r" });
      await vi.waitFor(() => expect(h.runs).toBe(1));
      expect(h.store.get(l3InFlightKey("r"))).toMatchObject({ sha: sha ?? null }); // on disk BEFORE the worker started
      restart(); // the host died; VS Code starts a new one
      h.hang = false;
      await expect(sharedAnalysis({ folderPath: "/ws", rootId: "r" })).rejects.toBeInstanceOf(L3Quarantined);
      expect(h.runs).toBe(1); // never started again
    }
  });

  it("a pass that ends clears its sentinel, so the next session analyses as usual", async () => {
    await sharedAnalysis({ folderPath: "/ws", rootId: "r" });
    expect(h.store.has(l3InFlightKey("r"))).toBe(false);
    restart();
    await sharedAnalysis({ folderPath: "/ws", rootId: "r" });
    expect(h.runs).toBe(2);
  });

  it("a sub-folder root's analysis is refused while its FOLDER is quarantined, and the other way round", async () => {
    h.store.set(l3QuarantineKey("r"), { sha: "aaa", at: 1, reason: "host-died" } satisfies L3QuarantineRecord);
    await expect(sharedAnalysis({ folderPath: "/ws", rootId: "r:packages/x", path: "packages/x" })).rejects.toBeInstanceOf(L3Quarantined);
    expect(h.runs).toBe(0);
    h.store.clear();
    restart();
    h.store.set(l3QuarantineKey("r:packages/x"), { sha: "aaa", at: 1, reason: "host-died" } satisfies L3QuarantineRecord);
    expect(await l3BlockedFor("r:packages/x", "packages/x", "aaa")).toBeDefined();
    expect(await l3BlockedFor("r", undefined, "aaa")).toBeUndefined(); // the folder itself is not held by a sub-folder's crash
  });
});

describe("L3 crash guard — no false quarantine, and the escape hatch", () => {
  // regression: a window reload (or VS Code closing, an update) mid-pass left the sentinel, and the next session quarantined
  // a tree that had never crashed anything — with no way out but waiting for a commit or 24 h.
  it("regression: a clean deactivation mid-pass clears the sentinel, so the next session analyses as usual", async () => {
    h.hang = true;
    void sharedAnalysis({ folderPath: "/ws", rootId: "r" });
    await vi.waitFor(() => expect(h.store.has(l3InFlightKey("r"))).toBe(true));
    await clearL3InFlight(); // `beforeKnowledgeShutdown`, awaited before the stores close
    expect(h.store.has(l3InFlightKey("r"))).toBe(false);
    restart();
    h.hang = false;
    await sharedAnalysis({ folderPath: "/ws", rootId: "r" });
    expect(h.runs).toBe(2);
  });

  it("lift() ends a quarantine at once, and the guard's one line names the retry command", async () => {
    await l3CrashGuard("r", { memento: () => memento }).begin("aaa"); // the host dies here
    const log = vi.fn();
    const guard = l3CrashGuard("r", { memento: () => memento, log });
    expect(await guard.blocked("aaa")).toBeDefined();
    expect(log.mock.calls[0]![0]).toContain("builderforce.knowledge.retryAnalyzers");
    await guard.lift();
    expect(await guard.blocked("aaa")).toBeUndefined();
    expect(h.store.has(l3QuarantineKey("r"))).toBe(false);
  });
});

describe("the indexer's requested L3 pass over the real guard (end to end)", () => {
  const plan = (): IndexPlan => ({ files: 1, changed: [], removed: [], reviewed: true, ms: 1, detail: { prior: new Map() } as unknown as PlanDetail });

  /** An indexer whose analyzers' pass goes through `sharedAnalysis` and reports a failure the way memory's review does. */
  function indexer() {
    const mapPass = vi.fn(async (_p: IndexPlan, o: { analyzers: boolean; signal: AbortSignal }) => {
      if (!o.analyzers) return { changed: [] as string[] };
      try {
        await sharedAnalysis({ folderPath: "/ws", rootId: "r" }, { signal: o.signal });
        return { changed: [] as string[] };
      } catch (error) {
        return { changed: [] as string[], analyzerFailures: [`code: ${(error as Error).message}`] }; // recorded, never thrown
      }
    });
    const errors: string[] = [];
    const ports: IndexRootPorts = {
      rootId: "r", plan: async () => plan(), extractEdited: async () => ({ changed: [], unreviewed: [] }), mapPass, onFactsChanged: async () => undefined,
      l3State: l3StateOf({ rootId: "r", rootPath: "/ws" }, { head: async () => h.sha }),
    };
    const root = new RootIndexer({
      ports, clock: realClock, gate: { pausedBy: () => undefined, idleForMs: () => L3_IDLE_MAINS_MS }, power: { current: async () => "mains" },
      priorityOf: () => PRIORITY.rest, publish: () => undefined, telemetry: () => undefined, log: (what, error) => { errors.push(`${what}: ${String(error)}`); },
    });
    return { root, mapPass, errors, analyses: () => h.runs };
  }

  for (const [name, error] of [
    ["an over-budget result", Object.assign(new Error("l3_result_over_budget: too big"), { code: "l3_result_over_budget" })],
    ["a worker out of memory", Object.assign(new Error("Worker terminated due to reaching memory limit"), { code: "ERR_WORKER_OUT_OF_MEMORY" })],
  ] as const) {
    it(`regression: ${name} is a failed pass, not done, and is not run again for the same sha — not even after a restart`, async () => {
      h.fail = error;
      const first = indexer();
      await first.root.reconcile();
      expect(await first.root.requestL3()).toBe(false);
      expect(first.errors.some((e) => e.startsWith("L3 analyzers:"))).toBe(true);
      expect(first.root.status().ready).toBe(2); // never L3-ready
      expect(h.store.has("builderforce.knowledge.l3Done.r")).toBe(false); // never marked done
      expect(await first.root.requestL3()).toBe(false);
      expect(first.analyses()).toBe(1);
      restart();
      const second = indexer();
      await second.root.reconcile();
      expect(await second.root.requestL3()).toBe(false);
      expect(h.runs).toBe(1);
      h.sha = "bbb"; // the commit moved
      h.fail = undefined;
      expect(await second.root.requestL3()).toBe(true);
      expect(h.runs).toBe(2);
    });
  }
});
