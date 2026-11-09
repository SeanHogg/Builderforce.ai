import { describe, expect, it, vi } from "vitest";
import type { ShellCapability } from "./capabilities.js";
import { filterShellOutput, outputFilterTool } from "./shell-output-filter.js";
import type { ToolContext } from "./tool.js";

const LOG = ["src/a.ts(3,1): error TS2304: Cannot find name 'x'.", "compiling…", "src/b.ts(9,2): Error TS1005: ';' expected.", "done in 98s"].join("\n");

describe("filterShellOutput", () => {
  it("greps with line numbers; ignoreCase widens it", () => {
    expect(filterShellOutput(LOG, { grep: "error TS" })).toMatchObject({ matchedLines: 1, output: "1: src/a.ts(3,1): error TS2304: Cannot find name 'x'." });
    expect(filterShellOutput(LOG, { grep: "error ts", ignoreCase: true }).matchedLines).toBe(2);
  });

  it("matches an invalid regular expression literally", () => {
    expect(filterShellOutput("a(b\nc", { grep: "a(" }).output).toBe("1: a(b");
  });

  it("head and tail cut the (matched) lines", () => {
    expect(filterShellOutput(LOG, { head: 1 }).output).toBe("src/a.ts(3,1): error TS2304: Cannot find name 'x'.");
    expect(filterShellOutput(LOG, { tail: 1 })).toMatchObject({ output: "done in 98s", truncated: true });
    expect(filterShellOutput(LOG, { head: 1, tail: 1 }).output.split("\n")).toHaveLength(2);
  });

  it("with no head / tail a huge output comes back as its first and last 100 lines", () => {
    const big = Array.from({ length: 1_000 }, (_, i) => `l${i}`).join("\n");
    const r = filterShellOutput(big, {});
    expect(r.output.split("\n")).toHaveLength(200);
    expect(r.truncated).toBe(true);
    expect(r.output.endsWith("l999")).toBe(true);
  });
});

function ctxWith(shell: Partial<ShellCapability>): ToolContext {
  return { caps: { capabilities: new Set(["shell", "shell.outputs"]), shell: { run: vi.fn(), ...shell } as ShellCapability } } as never;
}

describe("output_filter", () => {
  it("filters a retained output without running anything", async () => {
    const run = vi.fn();
    const output = vi.fn(async () => LOG);
    const r = await outputFilterTool.execute({ outputId: "out-3", grep: "error", ignoreCase: true }, ctxWith({ run, output }));
    expect(output).toHaveBeenCalledWith("out-3");
    expect(run).not.toHaveBeenCalled();
    expect(r.data).toMatchObject({ ok: true, outputId: "out-3", matches: 2, totalLines: 4 });
  });

  it("an evicted / unknown id says so", async () => {
    const r = await outputFilterTool.execute({ outputId: "out-99" }, ctxWith({ output: async () => undefined }));
    expect(r.data).toMatchObject({ ok: false, outputId: "out-99" });
    expect(String(r.data.error)).toMatch(/no retained output/);
  });

  it("refuses without an id, and on a shell that keeps no outputs", async () => {
    expect((await outputFilterTool.execute({}, ctxWith({ output: async () => "x" }))).data.ok).toBe(false);
    expect(String((await outputFilterTool.execute({ outputId: "out-1" }, ctxWith({}))).data.error)).toMatch(/not available/);
  });

  it("is advertised only where retained outputs are", () => {
    expect(outputFilterTool.requires).toEqual(["shell.outputs"]);
  });
});
