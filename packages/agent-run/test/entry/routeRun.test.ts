/** routeRun — parity with the Brain's old `pipelineRoute.ts`: the route, where the run starts, which model it pins. */
import { describe, expect, it } from "vitest";
import { routeRun } from "../../src/index.js";

const REQUEST = "Rename the helper in utils.ts";
// threshold 1 ⇒ P(full) can never reach it ⇒ quick; `always` ⇒ full.
const QUICK = { mode: "auto" as const, threshold: 1, quickModel: " fast-coder " };

describe("routeRun", () => {
  it("is unrouted without `routing`: no pipeline, plan start, verify not skipped", () => {
    const r = routeRun({ request: REQUEST });
    expect(r.pipeline).toBeNull();
    expect(r.start).toEqual({ startPhase: "plan" });
    expect(r.skipsVerify).toBe(false);
  });

  it("quick ⇒ code start on the quick model, pinned unless the model is strict, verify skipped", () => {
    const r = routeRun({ request: REQUEST, routing: QUICK });
    expect(r.pipeline?.route).toBe("quick");
    expect(r.start).toEqual({ startPhase: "code", phaseModels: { code: "fast-coder" }, pinnedModel: "fast-coder" });
    expect(r.skipsVerify).toBe(true);
    const strict = routeRun({ request: REQUEST, routing: QUICK, modelStrict: true });
    expect(strict.start).toEqual({ startPhase: "code", phaseModels: { code: "fast-coder" } });
  });

  it("full (always) ⇒ plan start, phase models passed through, nothing pinned", () => {
    const r = routeRun({ request: REQUEST, routing: { mode: "always", quickModel: "fast-coder" }, phaseModels: { plan: "big" } });
    expect(r.pipeline?.route).toBe("full");
    expect(r.start).toEqual({ startPhase: "plan", phaseModels: { plan: "big" } });
    expect(r.skipsVerify).toBe(false);
  });

});
