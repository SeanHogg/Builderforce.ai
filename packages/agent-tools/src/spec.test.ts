import { describe, expect, it } from "vitest";
import { coercePolicyGates, evaluatePolicyGate, renderPolicyDirectives, toolCallPaths, type PolicyGate } from "./spec.js";

const SECRET_WRITE: PolicyGate = {
  id: "no-secret-writes",
  tool: "write_file",
  effect: "block",
  paths: ["src/secret/**"],
  reason: "secrets are off-limits",
};

describe("toolCallPaths", () => {
  it("extracts path / filePath / oldPath / newPath / paths[]", () => {
    expect(toolCallPaths({ path: "src/a.ts" })).toEqual(["src/a.ts"]);
    expect(toolCallPaths({ filePath: "src/b.ts" })).toEqual(["src/b.ts"]);
    expect(toolCallPaths({ oldPath: "a.ts", newPath: "b.ts" })).toEqual(["a.ts", "b.ts"]);
    expect(toolCallPaths({ paths: ["a.ts", "b.ts"] })).toEqual(["a.ts", "b.ts"]);
    expect(toolCallPaths(undefined)).toEqual([]);
    expect(toolCallPaths({})).toEqual([]);
  });
});

describe("evaluatePolicyGate path scope", () => {
  it("blocks write_file on a path that hits the glob", () => {
    const decision = evaluatePolicyGate(
      [SECRET_WRITE],
      "write_file",
      toolCallPaths({ path: "src/secret/x.ts" }),
    );
    expect(decision).toEqual({
      action: "block",
      gateId: "no-secret-writes",
      reason: "secrets are off-limits",
    });
  });

  it("allows write_file on a path outside the glob", () => {
    const decision = evaluatePolicyGate(
      [SECRET_WRITE],
      "write_file",
      toolCallPaths({ path: "README.md" }),
    );
    expect(decision).toEqual({ action: "allow" });
  });

  it("leaves a path-scoped gate unmatched when the seam omits path", () => {
    expect(evaluatePolicyGate([SECRET_WRITE], "write_file")).toEqual({ action: "allow" });
  });

  it("still matches a tool-only gate when path is omitted", () => {
    const gate: PolicyGate = { id: "no-shell", tool: "run_command", effect: "block", reason: "no shell" };
    expect(evaluatePolicyGate([gate], "run_command").action).toBe("block");
    expect(evaluatePolicyGate([gate], "write_file").action).toBe("allow");
  });
});

describe("evaluatePolicyGate sideEffect", () => {
  const NO_MUTATION: PolicyGate = { id: "read-only", sideEffect: "mutate", effect: "block", reason: "read-only run" };

  it("blocks a mutating tool and leaves a read tool alone", () => {
    expect(evaluatePolicyGate([NO_MUTATION], "write_file")).toEqual({ action: "block", gateId: "read-only", reason: "read-only run" });
    expect(evaluatePolicyGate([NO_MUTATION], "read_file")).toEqual({ action: "allow" });
    expect(evaluatePolicyGate([NO_MUTATION], "run_checks")).toEqual({ action: "allow" });
  });

  it("fails closed: an unclassified tool counts as mutate", () => {
    expect(evaluatePolicyGate([NO_MUTATION], "some_new_tool").action).toBe("block");
  });

  it("requires every set criterion to match (tool + sideEffect)", () => {
    const gate: PolicyGate = { id: "g", tool: "read_file", sideEffect: "mutate", effect: "block" };
    expect(evaluatePolicyGate([gate], "read_file").action).toBe("allow");
    const both: PolicyGate = { id: "g2", tool: "write_file", sideEffect: "mutate", effect: "block" };
    expect(evaluatePolicyGate([both], "write_file").action).toBe("block");
    expect(evaluatePolicyGate([both], "edit_file").action).toBe("allow");
  });

  it("combines with a path scope", () => {
    const gate: PolicyGate = { id: "p", sideEffect: "mutate", paths: ["src/secret/**"], effect: "require-approval" };
    expect(evaluatePolicyGate([gate], "edit_file", ["src/secret/a.ts"]).action).toBe("require-approval");
    expect(evaluatePolicyGate([gate], "edit_file", ["README.md"]).action).toBe("allow");
    expect(evaluatePolicyGate([gate], "read_file", ["src/secret/a.ts"]).action).toBe("allow");
  });

  it("is preserved by coercePolicyGates and dropped when invalid", () => {
    const out = coercePolicyGates([
      { id: "a", effect: "block", sideEffect: "mutate" },
      { id: "b", effect: "block", sideEffect: "bogus" },
    ]);
    expect(out[0]!.sideEffect).toBe("mutate");
    expect(out[1]!.sideEffect).toBeUndefined();
  });

  it("renders as 'any mutating tool'", () => {
    expect(renderPolicyDirectives([NO_MUTATION])).toContain("Never use any mutating tool");
  });
});
