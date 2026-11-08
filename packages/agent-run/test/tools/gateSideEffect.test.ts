/**
 * `sideEffect` gates at the agent-run seam: the class is judged ONCE per call (against the catalog name the
 * call resolves to, not per synonym), the catalog is withheld by class, and an unknown tool is a mutation.
 */
import { describe, expect, it } from "vitest";
import type { PolicyGate } from "@builderforce/agent-tools";
import { evaluatePolicyGateSeam, isToolWithheld } from "../../src/index.js";

const NO_MUTATION: PolicyGate = { id: "read-only", sideEffect: "mutate", effect: "block", reason: "read-only run" };
const NO_READS: PolicyGate = { id: "no-reads", sideEffect: "read", effect: "block", reason: "no reads" };

describe("a mutate-class block gate", () => {
  it("keeps every read tool available, under any spelling or synonym", () => {
    for (const name of ["read_file", "list_files", "search_code", "Read", "Grep", "Glob", "ls"]) {
      expect(evaluatePolicyGateSeam([NO_MUTATION], name, {}).action, name).toBe("allow");
      expect(isToolWithheld([NO_MUTATION], name), name).toBe(false);
    }
  });

  it("withholds and refuses writes", () => {
    for (const name of ["write_file", "edit_file", "run_command", "Write", "bash"]) {
      expect(evaluatePolicyGateSeam([NO_MUTATION], name, {}).action, name).toBe("block");
      expect(isToolWithheld([NO_MUTATION], name), name).toBe(true);
    }
  });

  it("withholds a tool in neither catalog (fail closed)", () => {
    expect(isToolWithheld([NO_MUTATION], "some_new_tool")).toBe(true);
    expect(evaluatePolicyGateSeam([NO_MUTATION], "some_new_tool", {}).action).toBe("block");
  });

  it("lets a host-declared read-only tool through", () => {
    expect(isToolWithheld([NO_MUTATION], "page_lookup", { mutates: false })).toBe(false);
    expect(evaluatePolicyGateSeam([NO_MUTATION], "page_lookup", {}, undefined, { mutates: false }).action).toBe("allow");
    expect(isToolWithheld([NO_MUTATION], "page_edit", { mutates: true })).toBe(true);
  });

  it("does not stop a run from finishing or asking", () => {
    expect(isToolWithheld([NO_MUTATION], "finish")).toBe(false);
    expect(isToolWithheld([NO_MUTATION], "ask_human")).toBe(false);
  });
});

describe("a read-class block gate", () => {
  it("keeps write_file available and withholds the reads", () => {
    expect(isToolWithheld([NO_READS], "write_file")).toBe(false);
    expect(evaluatePolicyGateSeam([NO_READS], "write_file", {}).action).toBe("allow");
    expect(isToolWithheld([NO_READS], "read_file")).toBe(true);
    expect(isToolWithheld([NO_READS], "Grep")).toBe(true);
  });
});

describe("a tool plus class gate", () => {
  it("needs both", () => {
    const gate: PolicyGate = { id: "g", tool: "write_file", sideEffect: "mutate", effect: "block" };
    expect(isToolWithheld([gate], "write_file")).toBe(true);
    // A write gate also covers edit_file on purpose: see TOOL_NAME_SYNONYMS in src/policy/tools/gateToolNames.ts.
    expect(isToolWithheld([gate], "edit_file")).toBe(true);
    // A mutating tool outside the write family: same side-effect class, different tool name, so not withheld.
    expect(isToolWithheld([gate], "run_command")).toBe(false);
    const wrongClass: PolicyGate = { id: "g2", tool: "write_file", sideEffect: "read", effect: "block" };
    expect(isToolWithheld([wrongClass], "write_file")).toBe(false);
  });
});
