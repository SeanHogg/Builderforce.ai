import { describe, expect, it } from "vitest";
import { ensureWorkCoreSet, workCoreToolNames } from "./workCore.js";
import { selectToolsForTurn } from "./selectTools.js";
import { coreToolNames } from "./catalog.js";
import type { ToolSchema } from "@builderforce/agent-tools";

const schema = (name: string, description = ""): ToolSchema => ({ type: "function", function: { name, description, parameters: { type: "object", properties: {} } } });
const names = (tools: readonly ToolSchema[]): string[] => tools.map((t) => t.function?.name ?? "");

/** A realistic work catalog: the shared core set under their real names, plus extras. */
const CATALOG: ToolSchema[] = [
  ...[
    "read_file", "search_code", "list_files", "edit_file", "write_file", "run_command", "find_symbol",
    "file_outline", "command_status", "command_stop", "git_status", "git_diff", "recall_facts", "ask_user",
    "git_commit", "git_push", "output_filter", "wait_agents", "hand_off", "finish",
  ].map((n) => schema(n, "work")),
  ...Array.from({ length: 30 }, (_, i) => schema(`builtin_extra_${i}`, i < 5 ? "tasks board ticket" : "unrelated")),
];

describe("ensureWorkCoreSet — work mode never advertises fewer than the core edit/read/run/search set", () => {
  it("regression: work-mode turn always advertises the core tool set", () => {
    // A tiny cap (window fit) trims the fixed set far below the core set.
    const base = selectToolsForTurn(CATALOG, { query: "fix the typo", limit: 4, backfill: false });
    expect(base.tools.length).toBeLessThan(workCoreToolNames("code").length);
    const dropped: string[] = [];
    const ensured = ensureWorkCoreSet(base.tools, CATALOG, { role: "code", work: true, onDropped: (n) => dropped.push(n) });
    const have = new Set(names(ensured));
    for (const core of workCoreToolNames("code")) {
      if (names(CATALOG).includes(core)) expect(have.has(core)).toBe(true);
    }
    // Every core name present in the catalog was appended; nothing was dropped for fit.
    expect(dropped).toEqual([]);
  });

  it("a turn that already advertises the core set is unchanged (no duplicate appends)", () => {
    const full = selectToolsForTurn(CATALOG, { query: "fix the typo", limit: 64 });
    const ensured = ensureWorkCoreSet(full.tools, CATALOG, { role: "code", work: true });
    expect(new Set(names(ensured)).size).toBe(ensured.length);
  });

  it("a non-work turn is returned untouched", () => {
    const base = selectToolsForTurn(CATALOG, { query: "what is this", limit: 3, backfill: false });
    const ensured = ensureWorkCoreSet(base.tools, CATALOG, { role: "code", work: false });
    expect(names(ensured)).toEqual(names(base.tools));
  });

  it("when the window genuinely cannot fit a core tool, onDropped says so instead of silently omitting it", () => {
    const base = selectToolsForTurn(CATALOG, { query: "fix", limit: 2, backfill: false });
    const dropped: Array<{ name: string; reason: string }> = [];
    const ensured = ensureWorkCoreSet(base.tools, CATALOG, { role: "code", work: true, capacity: 5, onDropped: (name, reason) => dropped.push({ name, reason }) });
    expect(ensured.length).toBeLessThanOrEqual(5);
    // The core tools that did not fit were reported, not dropped silently.
    const have = new Set(names(ensured));
    for (const core of workCoreToolNames("code")) {
      if (!names(CATALOG).includes(core) || have.has(core)) continue;
      expect(dropped.some((d) => d.name === core && /could not fit/i.test(d.reason))).toBe(true);
    }
  });

  it("the work floor is at least the shared role core names", () => {
    for (const role of ["code", "verify"]) {
      for (const core of coreToolNames(role)) {
        expect(workCoreToolNames(role)).toContain(core);
      }
    }
  });
});
