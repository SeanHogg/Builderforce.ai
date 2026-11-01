/**
 * A registry command that never started because a steer was already waiting did not FAIL: the dispatch is not an error (so the breaker
 * does not count it), while the row it becomes still says it did not do its work.
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import type { RunPorts } from "../../src/index.js";
import { toolRow } from "../../src/runRows.js";
import { dispatchCall } from "../../src/runTurn.js";
import { freshState } from "../../src/runState.js";
import { TEST_POLICY, TEST_TASK } from "../support/policyContext.js";

describe("a registry command that never started", () => {
  it("is not a failed dispatch, and its row is still a failed one", async () => {
    const ports = {
      model: { complete: async () => ({ content: "" }) },
      capabilities: { capabilities: new Set<Capability>() },
      store: { load: () => undefined, save: () => undefined },
      events: { emit: () => undefined },
      human: { ask: async () => ({ kind: "paused" as const }) },
      context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    } as unknown as RunPorts;
    const waiting = { hasInterrupt: () => true, onInterrupt: () => () => undefined };
    const args = { command: "npm test" };
    const call = { id: "c1", name: "run_command", args, raw: { id: "c1", name: "run_command", arguments: JSON.stringify(args) }, malformed: false };

    const result = await dispatchCall({ task: TEST_TASK, policy: TEST_POLICY, ports }, freshState(TEST_POLICY, TEST_TASK), call, waiting);

    expect(result.data).toMatchObject({ ok: false, skipped: true });
    // not counted as a failed dispatch: the failure breaker never sees it ...
    expect(result.isError).toBeUndefined();
    // ... and the row the model reads is still the failed one
    expect(toolRow("c1", result).isError).toBe(true);
  });
});
