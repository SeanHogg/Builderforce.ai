/**
 * knowledge-notes — the session-note heuristic.
 *
 * The regression these guard: every tool name the original heuristic matched on
 * (`grep`, `glob`, `view`, `test`, `bash`, `code_analysis`, `project_knowledge`,
 * `orchestrate`, `workflow_status`) is NOT a registered tool in this package, so
 * the analysis/review/workflow/test labels were unreachable and every real run
 * collapsed into the generic "Code modifications: N file(s) changed". These tests
 * pin the labels against the tool names the tools ACTUALLY register under.
 */

import { describe, expect, it } from "vitest";

import { buildKnowledgeMemoryEntry, deriveActivitySummary } from "./knowledge-notes.js";

describe("deriveActivitySummary", () => {
  it("labels a read-only exploration run as analysis, not a generic edit", () => {
    expect(deriveActivitySummary({ tools: ["search_code", "read_file", "find_symbol"] })).toBe(
      "Codebase exploration / read-only analysis",
    );
  });

  it("reaches the analysis branch through the legacy tool aliases", () => {
    expect(deriveActivitySummary({ tools: ["grep", "glob", "view"] })).toBe(
      "Codebase exploration / read-only analysis",
    );
  });

  it("does not call a run that ran the checks a read-only analysis", () => {
    expect(deriveActivitySummary({ tools: ["search_code", "run_checks"] })).not.toBe(
      "Codebase exploration / read-only analysis",
    );
  });

  it("labels a review run from the real git/symbol tools", () => {
    expect(deriveActivitySummary({ tools: ["git_diff", "git_history"] })).toBe(
      "Code review / analysis",
    );
    expect(deriveActivitySummary({ tools: ["file_outline"] })).toBe("Code review / analysis");
  });

  it("labels a multi-agent run from the real spawn tool", () => {
    expect(deriveActivitySummary({ tools: ["spawn_agent"] })).toBe(
      "Multi-agent workflow execution",
    );
  });

  it("treats run_checks as test activity", () => {
    expect(deriveActivitySummary({ tools: ["run_checks"] })).toBe("Agent activity (no file changes)");
  });

  it("names the run's own prompt and the files it touched, not a fixed template", () => {
    expect(
      deriveActivitySummary({
        prompt: "Bound the shared-facts recall so a hung gateway cannot leak a socket",
        edited: ["api/src/application/llm/projectFacts.ts"],
      }),
    ).toBe("Bound the shared-facts recall so a hung gateway cannot leak a socket — projectFacts.ts");
  });

  it("caps the file list so a wide diff cannot swallow the prompt", () => {
    const summary = deriveActivitySummary({
      prompt: "Wire verify into every run loop",
      edited: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
    });
    expect(summary).toBe("Wire verify into every run loop — a.ts, b.ts, c.ts (+2 more)");
  });

  it("collapses a multi-line prompt onto one line", () => {
    expect(
      deriveActivitySummary({ prompt: "fix\n\n  the   flaky test", created: ["x.ts"] }),
    ).toBe("fix the flaky test — x.ts");
  });

  it("recognises a shipped change", () => {
    expect(deriveActivitySummary({ tools: ["git_commit", "git_push"] })).toBe(
      "Change shipped (commit/push)",
    );
  });

  it("falls back to the generic counts when the run recorded neither prompt nor path", () => {
    expect(deriveActivitySummary({ tools: ["run_checks"] })).toBe("Agent activity (no file changes)");
    expect(deriveActivitySummary({ tools: ["git_commit", "git_push"] })).toBe(
      "Change shipped (commit/push)",
    );
  });

  it("returns empty for a run with no activity at all", () => {
    expect(deriveActivitySummary({})).toBe("");
  });
});

describe("buildKnowledgeMemoryEntry", () => {
  it("writes no note for a run with no meaningful activity", () => {
    expect(buildKnowledgeMemoryEntry({ sessionKey: "s1", ts: "2026-08-20T10:00:00Z" })).toBeNull();
  });

  it("records the derived summary alongside the touched files", () => {
    const entry = buildKnowledgeMemoryEntry({
      sessionKey: "s1",
      ts: "2026-08-20T10:00:00Z",
      activity: { edited: ["a.ts", "b.ts"], tools: ["edit_file"] },
    });
    expect(entry).toContain("**Edited**: a.ts, b.ts");
    // No prompt was recorded, so the note falls back to the count label rather
    // than repeating the basenames the Edited line already carries.
    expect(entry).toContain("**Summary**: Code modifications: 2 file(s) changed");
  });

  it("carries the run's prompt into the note so it describes what happened", () => {
    const entry = buildKnowledgeMemoryEntry({
      sessionKey: "s1",
      ts: "2026-08-20T10:00:00Z",
      activity: { edited: ["retry.ts"], tools: ["edit_file"], prompt: "Stop the retry storm" },
    });
    expect(entry).toContain("**Summary**: Stop the retry storm — retry.ts");
  });

  it("collapses duplicate paths", () => {
    const entry = buildKnowledgeMemoryEntry({
      sessionKey: "s1",
      ts: "2026-08-20T10:00:00Z",
      activity: { edited: ["a.ts", "a.ts"] },
    });
    expect(entry).toContain("**Edited**: a.ts\n");
  });
});