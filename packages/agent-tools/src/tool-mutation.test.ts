/**
 * Proof for "Classify every mutating tool; CI fails on an unclassified one".
 *
 * Walks the live catalogs ({@link REGISTERED_TOOLS}), not a parallel name list, so
 * adding a tool without classifying it is a red test rather than a comment.
 */

import { describe, expect, it } from "vitest";
import {
  isMutatingTool,
  isVerifyTool,
  REGISTERED_TOOLS,
  staleClassifications,
  TOOL_SIDE_EFFECT,
  unclassifiedTools,
} from "./tool-mutation.js";

describe("tool mutation classification", () => {
  it("classifies every registered tool — unclassified fails CI", () => {
    expect(unclassifiedTools(REGISTERED_TOOLS)).toEqual([]);
  });

  it("has no stale classifications for tools that no longer exist", () => {
    expect(staleClassifications(REGISTERED_TOOLS)).toEqual([]);
  });

  it("registers unique names (a duplicate would silently drop a classification)", () => {
    const names = REGISTERED_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("treats file/git/memory writes and the shell as mutating", () => {
    for (const name of [
      "write_file",
      "edit_file",
      "delete_file",
      "run_command",
      "git_commit",
      "git_push",
      "memory_remember",
      "spawn_agent",
    ] as const) {
      expect(TOOL_SIDE_EFFECT[name]).toBe("mutate");
      expect(isMutatingTool(name)).toBe(true);
    }
  });

  it("treats reads, outlines, and control signals as read-only", () => {
    for (const name of [
      "read_file",
      "list_files",
      "git_status",
      "memory_recall",
      "wait_agents",
      "finish",
      "ask_human",
    ] as const) {
      expect(TOOL_SIDE_EFFECT[name]).toBe("read");
      expect(isMutatingTool(name)).toBe(false);
      expect(isVerifyTool(name)).toBe(false);
    }
  });

  it("classifies run_checks as verify (not a write, not a silent read)", () => {
    expect(TOOL_SIDE_EFFECT.run_checks).toBe("verify");
    expect(isVerifyTool("run_checks")).toBe(true);
    expect(isMutatingTool("run_checks")).toBe(false);
  });

  it("does not treat the general shell as a verify tool — run_command can delete", () => {
    expect(TOOL_SIDE_EFFECT.run_command).toBe("mutate");
    expect(isVerifyTool("run_command")).toBe(false);
    expect(isMutatingTool("run_command")).toBe(true);
  });

  it("treats an unclassified name as mutating (fail closed)", () => {
    expect(isMutatingTool("brand_new_tool")).toBe(true);
    expect(isMutatingTool("")).toBe(true);
    expect(isVerifyTool("brand_new_tool")).toBe(false);
  });
});
