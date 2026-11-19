import { describe, expect, it } from "vitest";
import {
  collectedDataText,
  compactArgs,
  COVERAGE_CHARS,
  coverageChars,
  coverageOf,
  establishedCalls,
  isDataCall,
  MAX_WINDOWS_PER_LINE,
  type CoverageStep,
} from "./childCoverage";

const page = (offset: number): CoverageStep => ({
  category: "tool",
  label: "builtin_tasks_list",
  args: { status: "backlog", limit: 5, offset, fields: "slim" },
  result: { ok: true, tasks: [{ id: offset + 1, title: `T${offset + 1}` }] },
});

/** The shape of chat #273's child run: the same ROADMAP window twice, backlog sampled at offsets, a write, a spawn. */
const TRACE: CoverageStep[] = [
  { category: "tool", label: "read_file", args: { path: "./Builderforce.ai/ROADMAP.md", offset: 1, limit: 400 }, result: { ok: true, offset: 1, content: "a\nb\nc", totalLines: 900, truncated: true } },
  { category: "tool", label: "read_file", args: { path: "Builderforce.ai/ROADMAP.md", limit: 400 }, result: { ok: true, offset: 1, content: "a\nb\nc", totalLines: 900, truncated: true } },
  { category: "tool", label: "read_file", args: { path: "Builderforce.ai/ROADMAP.md", offset: 401, limit: 400 }, result: { ok: true, offset: 401, content: "d\ne", totalLines: 900, truncated: true } },
  page(300),
  page(700),
  page(1100),
  page(300),
  { category: "tool", label: "builtin_tasks_list", args: { status: "nonexistent" }, result: { ok: false, error: "unknown status" }, isError: true },
  { category: "tool", label: "edit_file", args: { path: "src/a.ts" }, result: { ok: true } },
  { category: "tool", label: "run_command", args: { command: "pnpm test" }, result: { ok: true } },
  { category: "tool", label: "wait_agents", args: {}, result: { ok: true } },
  { category: "message", label: "run.children_hold_released", result: "x" },
];

describe("what a run already read (chat #273)", () => {
  it("classes reads and unknown platform calls as data — never writes, commands, control calls or failures", () => {
    expect(TRACE.filter(isDataCall).map((s) => s.label)).toEqual([
      "read_file", "read_file", "read_file", "builtin_tasks_list", "builtin_tasks_list", "builtin_tasks_list", "builtin_tasks_list",
    ]);
  });

  it("folds a file's windows into one line (a window read twice is listed once) and lists each data call once", () => {
    expect(establishedCalls(TRACE)).toEqual([
      "read_file Builderforce.ai/ROADMAP.md lines 1-3 of 900, 401-402 of 900",
      `builtin_tasks_list ${compactArgs("builtin_tasks_list", page(300).args)}`,
      `builtin_tasks_list ${compactArgs("builtin_tasks_list", page(700).args)}`,
      `builtin_tasks_list ${compactArgs("builtin_tasks_list", page(1100).args)}`,
    ]);
    expect(compactArgs("builtin_tasks_list", page(300).args)).toBe('{"fields":"slim","limit":5,"offset":300,"status":"backlog"}');
  });

  it("is the child's coverage too, inside its character budget", () => {
    const many: CoverageStep[] = Array.from({ length: 60 }, (_, i) => page(i * 5));
    const coverage = coverageOf(many);
    expect(coverageChars(coverage)).toBeLessThanOrEqual(COVERAGE_CHARS);
    expect(coverage.at(-1)).toMatch(/^… and \d+ more/);
  });

  it("caps the windows listed on one file's line", () => {
    const reads: CoverageStep[] = Array.from({ length: 10 }, (_, i) => ({
      category: "tool", label: "read_file", args: { path: "big.ts", offset: i * 100 + 1, limit: 100 }, result: { ok: true, offset: i * 100 + 1, content: "x" },
    }));
    const [line] = establishedCalls(reads);
    expect(line!.split(", ")).toHaveLength(MAX_WINDOWS_PER_LINE);
    expect(line).toContain(`(+${10 - MAX_WINDOWS_PER_LINE} more windows)`);
  });

  it("redacts secrets in arguments (the hand-off brief) and in results (the data file)", () => {
    const key = "sk-ant-api03-" + "a".repeat(40);
    const step: CoverageStep = { category: "tool", label: "web_fetch", args: { url: `https://x.test/?token=${key}` }, result: { ok: true, body: `Authorization: Bearer ${key}` } };
    expect(establishedCalls([step]).join("\n")).not.toContain(key);
    expect(collectedDataText([step], "data")).not.toContain(key);
  });

  it("keeps every data call's full result for the owner, in call order", () => {
    const text = collectedDataText(TRACE, "Data collected by sub-agent a1");
    expect(text.startsWith("# Data collected by sub-agent a1")).toBe(true);
    expect(text.match(/^## \d+\./gm)).toHaveLength(7);
    expect(text).toContain('"title": "T1101"');
    expect(collectedDataText([], "x")).toBe("");
  });
});
