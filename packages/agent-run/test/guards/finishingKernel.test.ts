/**
 * A FINISHING run through the kernel (VS Code chat #128305): once the guards decided a finish turn (`GuardsHook.isFinishing`), no
 * delivery rung sends its report back for more work, and the surface is told what that skipped (`DeliveryLedger.finalAccepted`).
 * Ported from the Brain's `brainDelivery.finishing.test.ts`, which asserted the same through its own ledger and its own flag.
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { createGuardsHook } from "../../src/policy/guards/index.js";
import { stallHook } from "../../src/policy/stall/index.js";
import { runAgent, type ModelRequest, type PlatformTools, type RunPorts } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK, policyCtx, schemas } from "../support/policyContext.js";

const REPORT = "Final report: src/a.ts changed; the commit is still open.";

async function run(finishing: boolean) {
  const requests: ModelRequest[] = [];
  const restated: number[] = [];
  const accepted: Array<{ step: number; content: string }> = [];
  const platform: PlatformTools = {
    closed: true,
    verbatimText: true,
    schemas: () => schemas(["edit_file", "git_commit"]),
    selection: { query: "", limit: 50, required: new Set<string>() },
    execute: async () => ({ data: { ok: true } }),
  };
  const ports: RunPorts = {
    model: {
      complete: async (request) => {
        requests.push(request);
        if (requests.length > 4) throw new Error("the run kept re-prompting");
        return { content: REPORT };
      },
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: () => undefined },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    platform,
    delivery: {
      rungs: () => [{ id: "ship", applies: true, restate: ["Verify, self-review, then git_commit."], spent: "fall", onRestate: (n) => { restated.push(n); } }],
      finalAccepted: (turn) => { accepted.push(turn); },
    },
  };
  const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports, modules: { guards: { ...createGuardsHook(), isFinishing: () => finishing } } });
  return { outcome, requests, restated, accepted };
}

describe("regression: chat #128305 — a finishing run is never sent back by a delivery gate", () => {
  it("control: a run that is not finishing owes the rung, and is sent back; the ledger is not told it skipped anything", async () => {
    const { restated, accepted } = await run(false);
    expect(restated.length).toBeGreaterThan(0);
    expect(accepted).toEqual([]);
  });

  it("regression: a finishing run is asked no rung, its report finishes the run, and the ledger is told once what was skipped", async () => {
    const { outcome, requests, restated, accepted } = await run(true);
    expect(restated).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(outcome.kind).toBe("finished");
    expect(accepted).toEqual([{ step: expect.any(Number), content: REPORT }]);
  });

  it("the stall policy walks no rung for a finishing turn, while narration is still judged", async () => {
    let asked = 0;
    const ctx = policyCtx({
      ports: { delivery: { rungs: () => { asked += 1; return []; } } } as never,
    });
    ctx.content = REPORT;
    ctx.finishing = true;
    expect(await stallHook.recoverAsync(ctx)).toBeUndefined();
    expect(asked).toBe(0);
    delete ctx.finishing;
    await stallHook.recoverAsync(ctx);
    expect(asked).toBe(1);
  });
});
