/**
 * A surface's own command that its signal KILLED reads true for how it died: a steered message interrupted it, or the person's Stop
 * did. Either way the row fails and says so; neither is a failure of the command, so neither feeds the failure streak. A surface that
 * never sets `aborted` is unchanged: its stopped-looking result is an ordinary one.
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import type { ParsedToolCall } from "@builderforce/agent-loop";
import { dispatchCall } from "../../src/runTurn.js";
import { toolRow } from "../../src/runRows.js";
import { freshState } from "../../src/runState.js";
import type { PlatformToolResult, RunPorts } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK, schemas } from "../support/policyContext.js";

const call: ParsedToolCall = { id: "c1", name: "exec", args: {}, raw: { id: "c1", name: "exec", arguments: "{}" } as never, malformed: false };

async function dispatch(execute: (signal: AbortSignal | undefined) => Promise<PlatformToolResult>, signal?: AbortSignal) {
  const ports = {
    model: { complete: async () => ({ content: "" }) },
    capabilities: { capabilities: new Set<Capability>() },
    platform: {
      closed: true,
      verbatimText: true,
      schemas: () => schemas(["exec"]),
      selection: { query: "", limit: 5, required: new Set<string>() },
      interruptible: () => true,
      execute: (_n: string, _a: unknown, env: { signal?: AbortSignal }) => execute(env.signal),
    },
  } as unknown as RunPorts;
  const state = freshState(TEST_POLICY, TEST_TASK);
  const watch = { hasInterrupt: () => false, onInterrupt: () => () => undefined };
  const result = await dispatchCall({ task: TEST_TASK, policy: TEST_POLICY, ports, ...(signal ? { signal } : {}) }, state, call, watch);
  return { result, row: toolRow("c1", result, true) };
}

describe("a command its signal killed", () => {
  it("a Stop reads as a stop, not as a message to read next", async () => {
    const stop = new AbortController();
    const { result, row } = await dispatch(async () => { stop.abort(); return { data: "partial output", aborted: true }; }, stop.signal);
    const data = result.data as Record<string, unknown>;
    expect(String(data.error)).toContain("Stopped by the user");
    expect(row.content).not.toContain("new message");
    expect(row.content).not.toContain("Read the message that follows");
    expect(data.output).toBe("partial output");
    expect(row.isError).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("a steered message reads as the message that interrupted it", async () => {
    const { result, row } = await dispatch(async () => ({ data: "partial output", aborted: true }));
    expect(String((result.data as Record<string, unknown>).error)).toContain("Interrupted by the user's new message");
    expect(row.content).toContain("Read the message that follows");
    expect(row.isError).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("a surface that never sets `aborted` is unchanged: a result that merely looks stopped is an ordinary one", async () => {
    const { result, row } = await dispatch(async () => ({ data: { aborted: true, interrupted: true, error: "x" } }));
    expect(row.isError).toBeUndefined();
    expect(result.isError).toBeUndefined();
  });
});
