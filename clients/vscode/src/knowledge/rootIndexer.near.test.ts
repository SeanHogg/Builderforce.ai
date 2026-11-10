/**
 * rootIndexer.near.test.ts — WS4 at the indexer's seam (PRD 41 §B1, §B6 scheduling 3):
 *   - files within 2 import hops of an open file (the root's fact graph, `ports.near`) are queued ahead of recently
 *     committed and other files, behind open and visible ones;
 *   - the L2 step receives the fact kinds that really moved (`extractEdited` → `changedKinds`), not every kind.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanDetail } from "@seanhogg/builderforce-memory/knowledge";
import { realClock } from "./indexBudget";
import { ALL_FACT_KINDS, type FactKind } from "./indexLevels";
import type { IndexPlan } from "./indexReconcile";
import { PRIORITY } from "./indexScheduler";
import { RootIndexer, type IndexRootPorts } from "./rootIndexer";

const plan: IndexPlan = { files: 5, changed: [], removed: [], reviewed: true, ms: 1, detail: { prior: new Map() } as unknown as PlanDetail };

function harness(kinds?: readonly FactKind[]) {
  const near = vi.fn((seeds: readonly string[]) => new Set([...seeds, "src/b.ts", "src/c.ts"]));
  const ports = {
    rootId: "r",
    plan: vi.fn(async () => plan),
    extractEdited: vi.fn(async (batch: readonly string[]) => ({ changed: [...batch], unreviewed: [] as string[], ...(kinds ? { changedKinds: kinds } : {}) })),
    mapPass: vi.fn(async () => ({ changed: [] as string[] })),
    onFactsChanged: vi.fn(async (_p: readonly string[], _k: readonly FactKind[]) => undefined),
    near,
  } satisfies IndexRootPorts;
  const indexer = new RootIndexer({
    ports, clock: realClock, gate: { pausedBy: () => undefined, idleForMs: () => 600_000 }, power: { current: async () => "mains" },
    priorityOf: (p) => (p === "src/a.ts" ? PRIORITY.open : PRIORITY.rest),
    openPaths: () => ["src/a.ts"],
    publish: () => undefined, telemetry: () => undefined, log: () => undefined,
  });
  return { ports, indexer, near };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("RootIndexer — the near level (B6 scheduling 3)", () => {
  it("queues files within 2 import hops of an open file ahead of the rest, behind the open file", async () => {
    const h = harness();
    const run = h.indexer.edited(["src/z.ts", "src/c.ts", "src/a.ts", "src/b.ts"]);
    await vi.advanceTimersByTimeAsync(10);
    await run;
    expect(h.ports.extractEdited.mock.calls.flatMap(([batch]) => batch)).toEqual(["src/a.ts", "src/c.ts", "src/b.ts", "src/z.ts"]);
    expect(h.near).toHaveBeenCalledWith(["src/a.ts"]);
    expect(PRIORITY.open < PRIORITY.visible && PRIORITY.visible < PRIORITY.near && PRIORITY.near < PRIORITY.recent && PRIORITY.recent < PRIORITY.rest).toBe(true);
  });

  it("the near set is memoised per open set and recomputed after facts change", async () => {
    const h = harness();
    const first = h.indexer.edited(["src/z.ts", "src/y.ts"]);
    await vi.advanceTimersByTimeAsync(10);
    await first;
    const calls = h.near.mock.calls.length;
    const second = h.indexer.edited(["src/x.ts"]);
    await vi.advanceTimersByTimeAsync(10);
    await second;
    // The first batch's facts moved, so the second push re-reads the import graph once.
    expect(h.near.mock.calls.length).toBe(calls + 1);
  });
});

describe("RootIndexer — the L2 step gets the kinds that moved", () => {
  it("passes the extract step's changed kinds through", async () => {
    const h = harness(["body", "content"]);
    const run = h.indexer.edited(["src/b.ts"]);
    await vi.advanceTimersByTimeAsync(10);
    await run;
    expect(h.ports.onFactsChanged).toHaveBeenCalledWith(["src/b.ts"], ["body", "content"]);
  });

  it("a port that reports no kinds means every kind", async () => {
    const h = harness();
    const run = h.indexer.edited(["src/b.ts"]);
    await vi.advanceTimersByTimeAsync(10);
    await run;
    expect(h.ports.onFactsChanged).toHaveBeenCalledWith(["src/b.ts"], ALL_FACT_KINDS);
  });
});
