import { describe, expect, it } from "vitest";
import type { PolicyGate } from "@builderforce/agent-tools";
import {
  evaluatePolicyGateSeam as evaluateOnPremPolicyGate,
  policyRefusalMessage,
} from "@builderforce/agent-run";

const PATH_BLOCK: PolicyGate = {
  id: "no-secrets",
  effect: "block",
  tool: "write_file",
  paths: ["secrets/**"],
  reason: "do not write secrets",
};

const TOOL_BLOCK: PolicyGate = {
  id: "no-write",
  effect: "block",
  tool: "write_file",
  reason: "writes disabled",
};

describe("evaluateOnPremPolicyGate", () => {
  it("path-scoped block refuses write_file under that glob", () => {
    const d = evaluateOnPremPolicyGate([PATH_BLOCK], "write_file", {
      path: "secrets/key.txt",
    });
    expect(d.action).toBe("block");
    if (d.action === "block") {
      expect(d.gateId).toBe("no-secrets");
      expect(d.reason).toBe("do not write secrets");
      expect(policyRefusalMessage(d)).toContain("no-secrets");
    }
  });

  it("tool-only block still refuses write_file with any path", () => {
    const d = evaluateOnPremPolicyGate([TOOL_BLOCK], "write_file", { path: "src/a.ts" });
    expect(d.action).toBe("block");
    if (d.action === "block") expect(d.gateId).toBe("no-write");
  });

  it("path-scoped gate does not match when path is omitted", () => {
    const d = evaluateOnPremPolicyGate([PATH_BLOCK], "write_file", {});
    expect(d.action).toBe("allow");
  });

  it("path-scoped gate does not match a path outside the glob", () => {
    const d = evaluateOnPremPolicyGate([PATH_BLOCK], "write_file", { path: "src/a.ts" });
    expect(d.action).toBe("allow");
  });

  it("native write / SDK Write match a write_file gate", () => {
    const args = { path: "secrets/key.txt" };
    expect(evaluateOnPremPolicyGate([PATH_BLOCK], "write", args).action).toBe("block");
    expect(evaluateOnPremPolicyGate([PATH_BLOCK], "Write", args).action).toBe("block");
  });

  it("require-approval is refused with a no-pause message", () => {
    const gates: PolicyGate[] = [
      { id: "ask", effect: "require-approval", tool: "write_file", reason: "review writes" },
    ];
    const d = evaluateOnPremPolicyGate(gates, "write_file", { path: "src/a.ts" });
    expect(d.action).toBe("require-approval");
    if (d.action === "require-approval") {
      expect(policyRefusalMessage(d)).toContain("no approval pause");
    }
  });

  it("block wins over require-approval", () => {
    const gates: PolicyGate[] = [
      { id: "ask", effect: "require-approval", tool: "write_file", reason: "review" },
      TOOL_BLOCK,
    ];
    const d = evaluateOnPremPolicyGate(gates, "write_file", { path: "src/a.ts" });
    expect(d.action).toBe("block");
    if (d.action === "block") expect(d.gateId).toBe("no-write");
  });
});
