/**
 * A3's advisories (B1 readiness, B4 batching) are never trips, but they used to leave no row on
 * the run's timeline at all: `onTrip` returned early. Now they emit the one shared trace step.
 */
import { describe, expect, it } from "vitest";
import { READINESS_ADVISORY_NOTE } from "@builderforce/run-guards";
import { createGuardsHook, guardsTurnNote } from "../../src/policy/guards/index.js";
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

  it("regression: the advisory note reaches the model on the next turn's tail, across a durable tick, for one turn", async () => {
    const hook = createGuardsHook();
    const ctx = policyCtx({ policy: { levers: ["a3_progress_detector"] } });
    await hook.observe(ctx, { id: "r1", name: "read_file", args: { path: "f0.ts" } }, { ok: true });
    await hook.endTurn!(ctx, "Now I have everything I need.");
    expect(guardsTurnNote(ctx)).toContain(READINESS_ADVISORY_NOTE);
    // The cloud durable loop rebuilds the run's guards from the persisted state each tick.
    const resumed = policyCtx({ policy: { levers: ["a3_progress_detector"] } });
    resumed.state.guards = JSON.parse(JSON.stringify(ctx.state.guards));
    expect(guardsTurnNote(resumed)).toContain(READINESS_ADVISORY_NOTE);
    // Shown for exactly one turn.
    await hook.observe(resumed, { id: "r2", name: "read_file", args: { path: "f1.ts" } }, { ok: true });
    await hook.endTurn!(resumed, "");
    expect(guardsTurnNote(resumed)).not.toContain(READINESS_ADVISORY_NOTE);
  });
});
