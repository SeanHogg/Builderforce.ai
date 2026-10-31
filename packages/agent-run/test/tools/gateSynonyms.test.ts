/**
 * A gate authored against a catalog name covers the other spellings of the same act. A patch
 * writes and edits files, so a `block write_file` (or `edit_file`) gate covers `apply_patch`:
 * the tool is withheld from the catalog and a call to it is refused.
 */

import { describe, expect, it } from "vitest";
import type { PolicyGate } from "@builderforce/agent-tools";
import { evaluatePolicyGateSeam, isToolWithheld } from "../../src/index.js";

describe("apply_patch under a write or edit gate", () => {
  for (const tool of ["write_file", "write", "Write", "edit_file", "edit", "Edit"]) {
    it(`a block on ${tool} withholds apply_patch and refuses a call to it`, () => {
      const gates: PolicyGate[] = [{ id: "no-writes", tool, effect: "block", reason: "read-only tenant" }];
      expect(isToolWithheld(gates, "apply_patch")).toBe(true);
      expect(evaluatePolicyGateSeam(gates, "apply_patch", { path: "src/a.ts" })).toMatchObject({ action: "block", gateId: "no-writes" });
    });
  }

  it("a path-scoped block refuses the matching patch and keeps the tool in the catalog", () => {
    const gates: PolicyGate[] = [{ id: "no-secrets", tool: "write_file", effect: "block", paths: ["secrets/**"], reason: "secrets" }];
    expect(isToolWithheld(gates, "apply_patch")).toBe(false);
    expect(evaluatePolicyGateSeam(gates, "apply_patch", { path: "secrets/key.txt" })).toMatchObject({ action: "block" });
    expect(evaluatePolicyGateSeam(gates, "apply_patch", { path: "src/a.ts" })).toEqual({ action: "allow" });
  });

  it("a block on a read does not touch apply_patch", () => {
    const gates: PolicyGate[] = [{ id: "no-reads", tool: "read_file", effect: "block" }];
    expect(isToolWithheld(gates, "apply_patch")).toBe(false);
  });
});
