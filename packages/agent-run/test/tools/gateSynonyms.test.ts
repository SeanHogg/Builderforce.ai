/**
 * A gate authored against a catalog name covers the other spellings of the same act. A patch writes and edits files, so a
 * `block write_file` (or `edit_file`) gate covers `apply_patch`: the tool is withheld from the catalog and a call to it is
 * refused. A path-scoped gate reads the files out of the patch itself, because `apply_patch`'s only argument is `{ input }`.
 * `nodes` with `action: "run"` runs a command, so an exec gate covers it at dispatch without withholding the whole tool.
 */

import { describe, expect, it } from "vitest";
import type { PolicyGate } from "@builderforce/agent-tools";
import { evaluatePolicyGateSeam, isToolWithheld } from "../../src/index.js";

/** The shape the model sends: one string in the `*** Begin Patch` format. */
const patch = (...sections: string[]): { input: string } => ({ input: ["*** Begin Patch", ...sections, "*** End Patch"].join("\n") });
const update = (file: string) => `*** Update File: ${file}\n@@\n-old\n+new`;

describe("apply_patch under a write or edit gate", () => {
  for (const tool of ["write_file", "write", "Write", "edit_file", "edit", "Edit"]) {
    it(`a block on ${tool} withholds apply_patch and refuses a call to it`, () => {
      const gates: PolicyGate[] = [{ id: "no-writes", tool, effect: "block", reason: "read-only tenant" }];
      expect(isToolWithheld(gates, "apply_patch")).toBe(true);
      expect(evaluatePolicyGateSeam(gates, "apply_patch", patch(update("src/a.ts")))).toMatchObject({ action: "block", gateId: "no-writes" });
    });
  }

  it("a block on a read does not touch apply_patch", () => {
    const gates: PolicyGate[] = [{ id: "no-reads", tool: "read_file", effect: "block" }];
    expect(isToolWithheld(gates, "apply_patch")).toBe(false);
  });
});

describe("a path-scoped gate on apply_patch reads the files the patch touches", () => {
  const gates: PolicyGate[] = [{ id: "no-secrets", tool: "write_file", effect: "block", paths: ["secrets/**"], reason: "secrets" }];

  it("keeps the tool in the catalog (the unmatched paths still need it)", () => {
    expect(isToolWithheld(gates, "apply_patch")).toBe(false);
  });

  it("refuses a patch that updates, adds or deletes a file under the scope", () => {
    for (const section of [update("secrets/key.txt"), "*** Add File: secrets/new.txt\n+x", "*** Delete File: secrets/old.txt"]) {
      expect(evaluatePolicyGateSeam(gates, "apply_patch", patch(section))).toMatchObject({ action: "block", gateId: "no-secrets" });
    }
  });

  it("refuses a patch that moves a file INTO the scope", () => {
    const moved = patch("*** Update File: src/a.ts\n*** Move to: secrets/a.ts\n@@\n-old\n+new");
    expect(evaluatePolicyGateSeam(gates, "apply_patch", moved)).toMatchObject({ action: "block" });
  });

  it("refuses a patch that touches the scope among other files", () => {
    expect(evaluatePolicyGateSeam(gates, "apply_patch", patch(update("src/a.ts"), update("secrets/key.txt")))).toMatchObject({ action: "block" });
  });

  it("allows a patch that stays outside the scope", () => {
    expect(evaluatePolicyGateSeam(gates, "apply_patch", patch(update("src/a.ts"), "*** Add File: docs/x.md\n+x"))).toEqual({ action: "allow" });
  });

  it("reads a patch with Windows line endings", () => {
    const crlf = { input: patch(update("secrets/key.txt")).input.replace(/\n/g, "\r\n") };
    expect(evaluatePolicyGateSeam(gates, "apply_patch", crlf)).toMatchObject({ action: "block" });
  });
});

describe("nodes action=run is the exec family at dispatch", () => {
  const exec: PolicyGate[] = [{ id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" }];

  it("an exec block refuses nodes with action run", () => {
    expect(evaluatePolicyGateSeam(exec, "nodes", { action: "run", node: "pi", command: ["ls"] })).toMatchObject({ action: "block", gateId: "no-shell" });
  });

  it("covers the exec family's other names too (a gate authored on run_command or Bash)", () => {
    for (const tool of ["run_command", "Bash", "bash"]) {
      const gates: PolicyGate[] = [{ id: "g", tool, effect: "require-approval" }];
      expect(evaluatePolicyGateSeam(gates, "nodes", { action: "run" })).toMatchObject({ action: "require-approval", gateId: "g" });
    }
  });

  it("leaves the tool's other actions alone, and the tool in the catalog", () => {
    expect(evaluatePolicyGateSeam(exec, "nodes", { action: "status" })).toEqual({ action: "allow" });
    expect(evaluatePolicyGateSeam(exec, "nodes", { action: "location_get" })).toEqual({ action: "allow" });
    expect(evaluatePolicyGateSeam(exec, "nodes", undefined)).toEqual({ action: "allow" });
    expect(isToolWithheld(exec, "nodes")).toBe(false);
  });

  it("does not make any other tool's action an exec", () => {
    expect(evaluatePolicyGateSeam(exec, "browser", { action: "run" })).toEqual({ action: "allow" });
  });
});
