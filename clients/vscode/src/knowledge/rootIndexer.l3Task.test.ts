/** `RootIndexer.runL3Task` (PRD 41 B6, §12.3): a queued L3 task (the run delta's analyzer phase) runs on the analyzers' gate. */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanDetail } from "@seanhogg/builderforce-memory/knowledge";
import type { PowerState } from "../power/powerSource";
import { L3_IDLE_MAINS_MS, realClock } from "./indexBudget";
import type { IndexPlan } from "./indexReconcile";
import { PRIORITY } from "./indexScheduler";
import { pendingL3Tasks, queueL3Task, registerL3Runner, takeL3Task } from "./l3Tasks";
import { RootIndexer, type IndexRootPorts } from "./rootIndexer";

const plan = (): IndexPlan => ({ files: 1, changed: [], removed: [], reviewed: true, ms: 1, detail: { prior: new Map() } as unknown as PlanDetail });

function harness(opts: { idle?: number; power?: PowerState; busy?: boolean } = {}) {
  const ports: IndexRootPorts = {
    rootId: "r",
    plan: async () => plan(),
    extractEdited: async () => ({ changed: [], unreviewed: [] }),
    mapPass: async () => ({ changed: [] }),
    onFactsChanged: async () => undefined,
    busy: () => opts.busy ?? false,
  };
  let paused: "typing" | undefined;
  const indexer = new RootIndexer({
    ports, clock: realClock, gate: { pausedBy: () => paused, idleForMs: () => opts.idle ?? 10 * 60_000 },
    power: { current: async () => opts.power ?? "mains" },
    priorityOf: () => PRIORITY.rest, publish: () => undefined, telemetry: () => undefined, log: () => undefined, quietPollMs: 10,
  });
  return { indexer, type: (p: "typing" | undefined) => { paused = p; } };
}

const stops: Array<() => void> = [];
afterEach(() => { while (stops.length) stops.pop()!(); while (takeL3Task("/ws")) { /* drain */ } });

function gated(root = "/ws/repo") {
  stops.push(registerL3Runner(() => ["/ws"]));
  const ran: AbortSignal[] = [];
  queueL3Task({ root, run: async (signal) => { ran.push(signal); } });
  return ran;
}

describe("RootIndexer.runL3Task", () => {
  it("runs ONE queued task of its root when idle on mains, as a long pass", async () => {
    const ran = gated();
    const h = harness();
    expect(await h.indexer.runL3Task("/ws")).toBe(true);
    expect(ran).toHaveLength(1);
    expect(pendingL3Tasks()).toBe(0);
    expect(await h.indexer.runL3Task("/ws")).toBe(false); // nothing left
  });

  it("waits while the person is not idle long enough, on battery, while a review runs, or while typing", async () => {
    for (const h of [harness({ idle: L3_IDLE_MAINS_MS - 1 }), harness({ power: "battery" }), harness({ busy: true })]) {
      const ran = gated();
      expect(await h.indexer.runL3Task("/ws")).toBe(false);
      expect(ran).toEqual([]);
      expect(pendingL3Tasks()).toBe(1);
      takeL3Task("/ws");
    }
    const typing = harness();
    typing.type("typing");
    const ran = gated();
    expect(await typing.indexer.runL3Task("/ws")).toBe(false);
    expect(ran).toEqual([]);
  });

  it("a task the gate stops (a keystroke aborts the pass) is put back at the head of the queue", async () => {
    stops.push(registerL3Runner(() => ["/ws"]));
    const h = harness();
    let started = false;
    queueL3Task({
      root: "/ws/repo",
      run: (signal) => new Promise<void>((resolve, reject) => {
        started = true;
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });
    const running = h.indexer.runL3Task("/ws");
    await vi.waitFor(() => expect(started).toBe(true));
    h.indexer.pauseLongPass();
    expect(await running).toBe(false);
    expect(pendingL3Tasks()).toBe(1);
  });

  it("never takes another root's task", async () => {
    stops.push(registerL3Runner(() => ["/elsewhere-claimed"]));
    const ran = gated("/elsewhere-claimed");
    expect(await harness().indexer.runL3Task("/ws")).toBe(false);
    expect(ran).toEqual([]);
    takeL3Task("/elsewhere-claimed");
  });
});
