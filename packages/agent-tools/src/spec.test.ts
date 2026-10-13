import { describe, expect, it } from "vitest";
import { evaluatePolicyGate, toolCallPaths, type PolicyGate } from "./spec.js";

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
