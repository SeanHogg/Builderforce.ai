/**
 * rootIndexer.facts.test.ts — the fact graph at the indexer (PRD 41 §B1, H1): it lives in memory (or is restored), so a
 * plan that finds NOTHING moved still syncs it ONCE per session, as a long pass after quiet (`facts`), and reports what
 * moved through the L2 step; a moving tree syncs it inside the map pass, and the L2 step gets `content` plus the fact
 * kinds that moved. A keystroke aborts the facts pass; it reruns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realClock } from "./indexBudget";
import { PRIORITY } from "./indexScheduler";
import { RootIndexer } from "./rootIndexer";
const planOf = (changed) => ({ files: 3, changed, removed: [], reviewed: true, ms: 1, detail: { prior: new Map(), files: [] } });
function harness(changed = []) {
    const syncFacts = vi.fn(async (_plan, _signal) => ({ changedPaths: ["src/a.ts"], changedKinds: ["structure"] }));
    const ports = {
        rootId: "r",
        plan: vi.fn(async () => planOf(changed)),
        extractEdited: vi.fn(async () => ({ changed: [], unreviewed: [] })),
        mapPass: vi.fn(async (plan) => ({ changed: [...plan.changed] })),
        syncFacts,
        onFactsChanged: vi.fn(async (_p, _k) => undefined),
    };
    let paused;
    const indexer = new RootIndexer({
        ports, clock: realClock, gate: { pausedBy: () => paused, idleForMs: () => 600_000 }, power: { current: async () => "mains" },
        priorityOf: () => PRIORITY.rest, publish: () => undefined, telemetry: () => undefined, log: () => undefined, quietPollMs: 50,
    });
    return { ports, indexer, setPaused: (p) => { paused = p; } };
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const settle = async (p) => { await vi.advanceTimersByTimeAsync(200); await p; };
describe("RootIndexer — the fact graph's sync (H1)", () => {
    it("an unchanged tree syncs the fact graph ONCE per session, as a long pass, reported through the L2 step", async () => {
        const h = harness();
        await settle(h.indexer.reconcile());
        expect(h.ports.mapPass).not.toHaveBeenCalled();
        expect(h.ports.syncFacts).toHaveBeenCalledTimes(1);
        expect(h.ports.onFactsChanged).toHaveBeenCalledWith(["src/a.ts"], ["structure"]);
        await settle(h.indexer.reconcile());
        expect(h.ports.syncFacts).toHaveBeenCalledTimes(1);
        expect(h.indexer.status().ready).toBe(2);
    });
    it("a moving tree syncs inside the map pass; the L2 step gets content plus the kinds that moved", async () => {
        const h = harness(["src/b.ts"]);
        await settle(h.indexer.reconcile());
        expect(h.ports.mapPass).toHaveBeenCalledTimes(1);
        expect(h.ports.syncFacts).toHaveBeenCalledTimes(1);
        expect(h.ports.onFactsChanged).toHaveBeenLastCalledWith(["src/a.ts", "src/b.ts"], ["structure", "content"]);
        // The session's sync happened: an unchanged reconcile after it runs no facts pass.
        h.ports.plan.mockResolvedValue(planOf([]));
        await settle(h.indexer.reconcile());
        expect(h.ports.syncFacts).toHaveBeenCalledTimes(1);
    });
    it("a keystroke aborts the facts pass; it reruns once the person is quiet", async () => {
        const h = harness();
        let calls = 0;
        h.ports.syncFacts.mockImplementation(async (_plan, signal) => {
            calls += 1;
            if (calls === 1) {
                h.indexer.pauseLongPass();
                expect(signal.aborted).toBe(true);
            }
            return { changedPaths: [], changedKinds: [] };
        });
        await settle(h.indexer.reconcile());
        expect(calls).toBe(2);
        expect(h.ports.onFactsChanged).not.toHaveBeenCalled(); // nothing moved: no L2 step
    });
});
//# sourceMappingURL=rootIndexer.facts.test.js.map