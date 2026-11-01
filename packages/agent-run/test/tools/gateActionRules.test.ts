/**
 * Action rules and synonyms (DATA in `gateToolNames.ts`): a tool whose arguments decide what it is evaluates as the family, and a gate
 * authored on one name covers the others.
 */

import { describe, expect, it } from "vitest";
import type { PolicyGate } from "@builderforce/agent-tools";
import { evaluatePolicyGateSeam, isToolWithheld } from "../../src/index.js";

const EXEC: PolicyGate[] = [{ id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" }];
const refuses = (gates: PolicyGate[], tool: string, args?: Record<string, unknown>) => evaluatePolicyGateSeam(gates, tool, args).action === "block";

describe("nodes invoke of a system command is exec", () => {
  it("refuses invoke of system.run (and the rest of system.*)", () => {
    expect(refuses(EXEC, "nodes", { action: "invoke", node: "pi", invokeCommand: "system.run", invokeParamsJson: "{\"command\":[\"ls\"]}" })).toBe(true);
    expect(refuses(EXEC, "nodes", { action: "invoke", invokeCommand: "System.Run.Prepare" })).toBe(true);
  });

  it("allows an invoke of a command outside system.*", () => {
    expect(refuses(EXEC, "nodes", { action: "invoke", invokeCommand: "camera.snap" })).toBe(false);
    expect(refuses(EXEC, "nodes", { action: "invoke", invokeCommand: "location.get" })).toBe(false);
  });

  it("allows an invoke with no command, and other actions", () => {
    expect(refuses(EXEC, "nodes", { action: "invoke" })).toBe(false);
    expect(refuses(EXEC, "nodes", { action: "status" })).toBe(false);
  });

  it("an approval gate on exec asks for approval of a system.run invoke", () => {
    const gates: PolicyGate[] = [{ id: "ask", tool: "exec", effect: "require-approval" }];
    expect(evaluatePolicyGateSeam(gates, "nodes", { action: "invoke", invokeCommand: "system.run" })).toMatchObject({ action: "require-approval", gateId: "ask" });
  });
});

describe("process acts on a command only when it writes to it", () => {
  it("an exec gate covers write, send-keys, submit, paste and kill", () => {
    for (const action of ["write", "send-keys", "submit", "paste", "kill"]) expect(refuses(EXEC, "process", { action, sessionId: "s" })).toBe(true);
  });

  it("and leaves list, poll and log alone, and the tool in the catalog", () => {
    for (const action of ["list", "poll", "log"]) expect(refuses(EXEC, "process", { action })).toBe(false);
    expect(isToolWithheld(EXEC, "process")).toBe(false);
  });
});

describe("synonyms", () => {
  it("a Task or spawn_agent gate covers sessions_spawn, and the reverse", () => {
    for (const tool of ["Task", "spawn_agent", "spawn_agents"]) expect(refuses([{ id: "g", tool, effect: "block" }], "sessions_spawn")).toBe(true);
    expect(refuses([{ id: "g", tool: "sessions_spawn", effect: "block" }], "Task")).toBe(true);
  });

  it("a search_code or list_files gate covers the on-prem grep, find and ls", () => {
    expect(refuses([{ id: "g", tool: "search_code", effect: "block" }], "grep")).toBe(true);
    expect(refuses([{ id: "g", tool: "Grep", effect: "block" }], "grep")).toBe(true);
    for (const tool of ["find", "ls"]) expect(refuses([{ id: "g", tool: "list_files", effect: "block" }], tool)).toBe(true);
    expect(refuses([{ id: "g", tool: "Glob", effect: "block" }], "ls")).toBe(true);
  });

  it("an unscoped block withholds them from the catalog", () => {
    expect(isToolWithheld([{ id: "g", tool: "search_code", effect: "block" }], "grep")).toBe(true);
    expect(isToolWithheld([{ id: "g", tool: "list_files", effect: "block" }], "find")).toBe(true);
    expect(isToolWithheld([{ id: "g", tool: "Task", effect: "block" }], "sessions_spawn")).toBe(true);
  });

  it("a read gate does not cover the exploration tools", () => {
    expect(refuses([{ id: "g", tool: "read_file", effect: "block" }], "grep")).toBe(false);
  });
});

describe("process remove", () => {
  it("is a write to a running exec session: an exec gate covers it", () => {
    expect(refuses(EXEC, "process", { action: "remove", sessionId: "s" })).toBe(true);
  });
});

describe("write and edit gates", () => {
  const gate = (tool: string): PolicyGate[] => [{ id: "g", tool, effect: "block" }];

  it("a write gate covers edit and apply_patch", () => {
    for (const tool of ["write", "write_file", "Write"]) for (const called of ["edit", "edit_file", "Edit", "apply_patch"]) expect(refuses(gate(tool), called)).toBe(true);
  });

  it("an edit gate covers edit and apply_patch, but not a plain write or a delete", () => {
    for (const tool of ["edit", "edit_file", "Edit"]) {
      expect(refuses(gate(tool), "edit_file")).toBe(true);
      expect(refuses(gate(tool), "apply_patch")).toBe(true);
      expect(refuses(gate(tool), "write_file")).toBe(false);
      expect(refuses(gate(tool), "delete_file")).toBe(false);
    }
  });
});

describe("tool names are matched case-insensitively, withheld or called", () => {
  it("a gate authored in any case judges a call in any case", () => {
    expect(refuses([{ id: "g", tool: "Run_Command", effect: "block" }], "RUN_COMMAND")).toBe(true);
    expect(refuses([{ id: "g", tool: "exec", effect: "block" }], " BASH ")).toBe(true);
    expect(isToolWithheld([{ id: "g", tool: "EXEC", effect: "block" }], "Run_Command")).toBe(true);
  });

  it("an alias resolves to the tool that will run", () => {
    expect(refuses(EXEC, "shell")).toBe(true);
    expect(refuses(EXEC, "run_terminal_cmd")).toBe(true);
    expect(refuses([{ id: "g", tool: "write_file", effect: "block" }], "create_file")).toBe(true);
    expect(refuses([{ id: "g", tool: "search_code", effect: "block" }], "codebase_search")).toBe(true);
  });
});
