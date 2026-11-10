/**
 * factGraphStore.sweep.test.ts — the fact store's sweep (PRD 41 §B4): run from the L3 gate's idle hook, at most ONCE per
 * session per root, after quiet, and only when the store's version moved since the last sweep.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFactGraph, memoryFactStore, saveFactGraph, FACTS_EXTRACTOR_VERSION, type FileFacts, type PlanDetail } from "@seanhogg/builderforce-memory/knowledge";
import { FactGraphStore } from "./factGraphStore";
import { realClock, L3_IDLE_MAINS_MS } from "./indexBudget";
import type { IndexPlan } from "./indexReconcile";
import { PRIORITY } from "./indexScheduler";
import { RootIndexer, type IndexRootPorts } from "./rootIndexer";

const facts = (hash: string): FileFacts => ({
  factsVersion: FACTS_EXTRACTOR_VERSION, extractor: "t", language: "typescript", contentHash: hash,
  symbols: [], imports: [], exports: [], entryPoints: [], calls: [], complexity: [], capabilityImports: [],
});

/** A store with one orphaned object (a file's facts replaced). */
async function storeWithOrphan() {
  const port = memoryFactStore();
  const first = await saveFactGraph(port, buildFactGraph([["a.ts", facts("a1")]], []).graph);
  await saveFactGraph(port, buildFactGraph([["a.ts", facts("a2")]], []).graph, first);
  return port;
}

describe("FactGraphStore.sweep", () => {
  it("sweeps once per session; a second call in the same session does nothing", async () => {
    const port = await storeWithOrphan();
    const store = new FactGraphStore(port, () => undefined);
    expect(await store.sweep()).toBe(1);
    expect(port.objectHashes()).toHaveLength(1);
    await saveFactGraph(port, buildFactGraph([["a.ts", facts("a3")]], []).graph);
    expect(await store.sweep()).toBe(0); // once per session
  });

  it("skips a store whose version has not moved since the last sweep; sweeps one that has", async () => {
    const port = await storeWithOrphan();
    const first = new FactGraphStore(port, () => undefined);
    await first.sweep();
    expect(await new FactGraphStore(port, () => undefined, first.sweptAt).sweep()).toBe(0);
    await saveFactGraph(port, buildFactGraph([["a.ts", facts("a4")]], []).graph);
    expect(await new FactGraphStore(port, () => undefined, first.sweptAt).sweep()).toBe(1);
  });

  it("an empty store (generation 0) is never swept", async () => {
    expect(await new FactGraphStore(memoryFactStore(), () => undefined).sweep()).toBe(0);
  });
});

describe("RootIndexer: the sweep runs from the L3 gate's idle hook", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function harness(idle: number, typing = false) {
    const sweepFacts = vi.fn(async () => 1);
    const ports = {
      rootId: "r",
      plan: vi.fn(async (): Promise<IndexPlan> => ({ files: 1, changed: [], removed: [], reviewed: true, ms: 1, detail: { prior: new Map() } as unknown as PlanDetail })),
      extractEdited: vi.fn(async () => ({ changed: [] as string[], unreviewed: [] as string[] })),
      mapPass: vi.fn(async () => ({ changed: [] as string[] })),
      onFactsChanged: vi.fn(async () => undefined),
      sweepFacts,
    } satisfies IndexRootPorts;
    const indexer = new RootIndexer({
      ports, clock: realClock, gate: { pausedBy: () => (typing ? "typing" : undefined), idleForMs: () => idle }, power: { current: async () => "battery" },
      priorityOf: () => PRIORITY.rest, publish: () => undefined, telemetry: () => undefined, log: () => undefined,
    });
    return { indexer, sweepFacts };
  }

  it("idle and quiet: it sweeps once per session (L3 itself waiting on battery does not stop it)", async () => {
    const h = harness(L3_IDLE_MAINS_MS);
    await h.indexer.maybeRunL3();
    await h.indexer.maybeRunL3();
    expect(h.sweepFacts).toHaveBeenCalledTimes(1);
  });

  it("not idle long enough, or typing: no sweep yet", async () => {
    const busy = harness(L3_IDLE_MAINS_MS - 1);
    await busy.indexer.maybeRunL3();
    expect(busy.sweepFacts).not.toHaveBeenCalled();
    const typing = harness(L3_IDLE_MAINS_MS, true);
    await typing.indexer.maybeRunL3();
    expect(typing.sweepFacts).not.toHaveBeenCalled();
  });
});
