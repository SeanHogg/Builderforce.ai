/**
 * The lowered (per-tool) form of a class gate serves a host that predates `sideEffect` gates and must decide EXACTLY as the
 * compact form does through the agent-run seam (what a run actually enforces) for every name that host can emit - the shared
 * catalog, the on-prem names, aliases - and it must never name the run-control tools, which the compact seam never touches.
 * Where lowering cannot apply (a tool in neither list, an `action`-dispatched call), only the compact form decides, and these
 * tests pin what it decides.
 */
import { describe, expect, it } from "vitest";
import {
  CONTROL_TOOL_NAMES, HOST_MUTATING_TOOLS, HOST_READ_ONLY_TOOLS, lowerSideEffectGates, TOOL_SIDE_EFFECT, TOOL_SIDE_EFFECTS, type PolicyGate,
} from "@builderforce/agent-tools";
import { evaluatePolicyGateSeam, isToolWithheld } from "../../src/index.js";

const ALIASES = ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "bash", "exec", "shell", "str_replace", "list_dir", "Task", "sessions_spawn"];
const NAMES = [...Object.keys(TOOL_SIDE_EFFECT), ...CONTROL_TOOL_NAMES, ...HOST_READ_ONLY_TOOLS, ...HOST_MUTATING_TOOLS, ...ALIASES];

describe("lowered class gates match the compact seam for every name an old host can emit", () => {
  for (const effect of ["block", "require-approval"] as const) {
    for (const cls of TOOL_SIDE_EFFECTS) {
      it(`${effect} on ${cls}`, () => {
        const compact: PolicyGate[] = [{ id: "g", sideEffect: cls, effect, reason: "r" }];
        const lowered = lowerSideEffectGates(compact);
        for (const name of NAMES) {
          expect(evaluatePolicyGateSeam(lowered, name, {}).action, name).toBe(evaluatePolicyGateSeam(compact, name, {}).action);
          expect(isToolWithheld(lowered, name), name).toBe(isToolWithheld(compact, name));
        }
      });
    }
  }

  it("never names a run-control tool", () => {
    for (const cls of TOOL_SIDE_EFFECTS) {
      const names = lowerSideEffectGates([{ id: "g", sideEffect: cls, effect: "block" }]).map((g) => g.tool);
      for (const control of CONTROL_TOOL_NAMES) expect(names).not.toContain(control);
    }
  });

  it("a decision names the authored gate, lowered or not", () => {
    const compact: PolicyGate[] = [{ id: "p1:ro", sideEffect: "mutate", effect: "block" }];
    const decision = evaluatePolicyGateSeam(lowerSideEffectGates(compact), "message", {});
    expect(decision).toMatchObject({ action: "block", gateId: "p1:ro" });
  });
});

describe("where only the compact form can decide (it is what every other host gets)", () => {
  const mutate: PolicyGate[] = [{ id: "g", sideEffect: "mutate", effect: "block" }];
  const read: PolicyGate[] = [{ id: "g", sideEffect: "read", effect: "block" }];

  it("an MCP-style unknown name is a mutation", () => {
    expect(evaluatePolicyGateSeam(mutate, "mcp__files__write", {}).action).toBe("block");
    expect(evaluatePolicyGateSeam(read, "mcp__files__write", {}).action).toBe("allow");
  });

  it("an action-dispatched host tool is judged by its action", () => {
    expect(evaluatePolicyGateSeam(mutate, "process", { action: "list" }).action).toBe("allow");
    expect(evaluatePolicyGateSeam(mutate, "process", { action: "poll" }).action).toBe("allow");
    expect(evaluatePolicyGateSeam(mutate, "process", { action: "kill" }).action).toBe("block");
    expect(evaluatePolicyGateSeam(mutate, "cron", {}).action).toBe("block");
  });

  it("the host read-only names are reads", () => {
    for (const name of ["memory_get", "agents_list"]) {
      expect(evaluatePolicyGateSeam(mutate, name, {}).action, name).toBe("allow");
      expect(evaluatePolicyGateSeam(read, name, {}).action, name).toBe("block");
    }
  });

  it("a host's explicit mutates:true beats the host read-only list", () => {
    expect(evaluatePolicyGateSeam(mutate, "memory_get", {}, undefined, { mutates: true }).action).toBe("block");
  });
});
