import { describe, expect, it } from "vitest";
import { gatesForWireLevel, lowerFrameGates, lowerSideEffectGates, understandsSideEffectGates } from "./gate-lowering.js";
import { coercePolicyGates, evaluatePolicyGate, type PolicyGate } from "./spec.js";
import { HOST_MUTATING_TOOLS, HOST_READ_ONLY_TOOLS, TOOL_SIDE_EFFECT } from "./tool-side-effect.js";

describe("lowerSideEffectGates", () => {
  const gate: PolicyGate = { id: "p1:ro", sideEffect: "mutate", effect: "block", reason: "read-only", paths: ["src/**"] };

  it("expands a class gate into one gate per tool of that class, keeping effect, paths and reason", () => {
    const lowered = lowerSideEffectGates([gate]);
    const mutating = [...Object.entries(TOOL_SIDE_EFFECT).filter(([, e]) => e === "mutate").map(([n]) => n), ...HOST_MUTATING_TOOLS];
    expect(lowered.map((g) => g.tool).sort()).toEqual([...mutating].sort());
    for (const g of lowered) {
      expect(g.sideEffect).toBeUndefined();
      expect(g).toMatchObject({ effect: "block", reason: "read-only", paths: ["src/**"], baseGateId: "p1:ro" });
      expect(g.id).toBe(`p1:ro:${g.tool}`);
    }
  });

  it("names the authored gate in a decision, so an old host and the cloud line up", () => {
    const lowered = lowerSideEffectGates([gate]);
    expect(evaluatePolicyGate(lowered, "write_file", ["src/a.ts"])).toMatchObject({ action: "block", gateId: "p1:ro" });
  });

  it("decides the same as the compact form for every catalog tool", () => {
    const compact: PolicyGate[] = [{ id: "ro", sideEffect: "mutate", effect: "block" }];
    const lowered = lowerSideEffectGates(compact);
    for (const name of Object.keys(TOOL_SIDE_EFFECT)) {
      expect(evaluatePolicyGate(lowered, name).action, name).toBe(evaluatePolicyGate(compact, name).action);
    }
  });

  it("includes the on-prem names an old host emits, for the read and mutate classes", () => {
    const read = lowerSideEffectGates([{ id: "r", sideEffect: "read", effect: "block" }]).map((g) => g.tool);
    for (const name of HOST_READ_ONLY_TOOLS) expect(read).toContain(name);
    const mutate = lowerSideEffectGates([{ id: "m", sideEffect: "mutate", effect: "block" }]).map((g) => g.tool);
    for (const name of ["message", "exec", "sessions_send"]) expect(mutate).toContain(name);
  });

  it("passes gates without a class through untouched and keeps a directive once", () => {
    const plain: PolicyGate = { id: "p", tool: "run_command", effect: "block" };
    const directive: PolicyGate = { id: "d", sideEffect: "mutate", effect: "inject-directive", directive: "Be careful." };
    const out = lowerSideEffectGates([plain, directive]);
    expect(out[0]).toBe(plain);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ id: "d", effect: "inject-directive", directive: "For any mutating tool: Be careful." });
  });

  it("narrows a tool plus class gate to that tool, or drops it when the classes disagree", () => {
    expect(lowerSideEffectGates([{ id: "g", tool: "write_file", sideEffect: "mutate", effect: "block" }]).map((g) => g.tool)).toEqual(["write_file"]);
    expect(lowerSideEffectGates([{ id: "g", tool: "read_file", sideEffect: "mutate", effect: "block" }])).toEqual([]);
  });
});

describe("lowering edge cases", () => {
  it("keeps a gate that names an unclassified tool when the class is mutate (unknown means mutate)", () => {
    const out = lowerSideEffectGates([{ id: "g", tool: "page_edit", sideEffect: "mutate", effect: "block" }]);
    expect(out).toEqual([{ id: "g:page_edit", baseGateId: "g", tool: "page_edit", effect: "block" }]);
  });

  it("lowers a mutate gate naming a host read-only tool to nothing, as the compact form does not match it", () => {
    expect(lowerSideEffectGates([{ id: "g", tool: "memory_get", sideEffect: "mutate", effect: "block" }])).toEqual([]);
    expect(evaluatePolicyGate([{ id: "g", tool: "memory_get", sideEffect: "mutate", effect: "block" }], "memory_get").action).toBe("allow");
  });

  it("never names finish or ask_human, in any class", () => {
    for (const cls of ["read", "verify", "mutate"] as const) {
      const tools = lowerSideEffectGates([{ id: "g", sideEffect: cls, effect: "block" }]).map((g) => g.tool);
      expect(tools).not.toContain("finish");
      expect(tools).not.toContain("ask_human");
    }
  });

  it("preserves baseGateId through coercion", () => {
    expect(coercePolicyGates([{ id: "a:t", baseGateId: "a", effect: "block", tool: "t" }])[0]?.baseGateId).toBe("a");
  });
});

describe("wire level", () => {
  const gates: PolicyGate[] = [{ id: "g", sideEffect: "mutate", effect: "block" }];

  it("understandsSideEffectGates is true only for a declared level of 2 or more", () => {
    expect(understandsSideEffectGates("2")).toBe(true);
    expect(understandsSideEffectGates(3)).toBe(true);
    expect(understandsSideEffectGates("1")).toBe(false);
    expect(understandsSideEffectGates(undefined)).toBe(false);
    expect(understandsSideEffectGates("abc")).toBe(false);
  });

  it("gatesForWireLevel is compact for a declared client and lowered for everyone else", () => {
    expect(gatesForWireLevel(gates, "2")).toEqual(gates);
    expect(gatesForWireLevel(gates, undefined).every((g) => g.sideEffect === undefined && g.tool)).toBe(true);
  });

  it("lowerFrameGates lowers the payload of a frame for a host without the level, and leaves every other frame alone", () => {
    const frame = { type: "task.assign", executionId: 1, payload: JSON.stringify({ model: "m", policyGates: gates }) };
    const old = lowerFrameGates(frame, undefined);
    const lowered = JSON.parse(old.payload) as { model: string; policyGates: PolicyGate[] };
    expect(lowered.model).toBe("m");
    expect(lowered.policyGates.every((g) => g.sideEffect === undefined && typeof g.tool === "string")).toBe(true);
    expect(lowerFrameGates(frame, "2")).toBe(frame);
    const plain = { type: "task.assign", payload: JSON.stringify({ policyGates: [{ id: "x", tool: "run_command", effect: "block" }] }) };
    expect(lowerFrameGates(plain, undefined)).toBe(plain);
    expect(lowerFrameGates({ type: "task.assign", payload: "not json" }, undefined)).toEqual({ type: "task.assign", payload: "not json" });
  });
});
