/**
 * A3's advisories (B1 readiness, B4 batching) are never trips, but they used to leave no row on
 * the run's timeline at all: `onTrip` returned early. Now they emit the one shared trace step.
 */
import { describe, expect, it } from "vitest";
import { createGuardsHook } from "../../src/policy/guards/index.js";
import { policyCtx } from "../support/policyContext.js";

describe("guards hook — progress advisory", () => {
  it("a readiness advisory emits one loop.progress_advisory event, and no progress_check", async () => {
    const events: Array<{ tool: string; detail: Record<string, unknown>; result: string }> = [];
    const hook = createGuardsHook({ onEvent: (e) => { events.push(e); } });
    const ctx = policyCtx({ policy: { levers: ["a3_progress_detector"] } });
    await hook.observe(ctx, { id: "r1", name: "read_file", args: { path: "f0.ts" } }, { ok: true });
    await hook.endTurn!(ctx, "Now I have everything I need.");
    expect(events).toEqual([{
      tool: "loop.progress_advisory",
      detail: { advisory: "readiness" },
      result: "progress advisory (readiness): a one-off note on the next turn, not a trip",
    }]);
  });
});
