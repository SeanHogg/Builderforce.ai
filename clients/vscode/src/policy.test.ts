import { describe, expect, it } from "vitest";
import { evaluatePolicyGate, toolCallPaths, type PolicyGate } from "./policy";

const SECRET_WRITE: PolicyGate = {
  id: "no-secret-writes",
  tool: "write_file",
  effect: "block",
  paths: ["src/secret/**"],
  reason: "secrets are off-limits",
};

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
});
