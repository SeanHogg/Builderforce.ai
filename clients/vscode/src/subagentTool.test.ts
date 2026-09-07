import { describe, expect, it, vi } from "vitest";
import { childToolDefs, subagentToolDef } from "./subagentTool";
import type { ToolDef } from "./fileTools";
import type { BrainToolSpec } from "@seanhogg/builderforce-brain-embedded";

/**
 * Delegation on the MACHINE. The child's tool set is the security boundary here — a
 * nested loop cannot raise the local approval prompt, so a mutating tool reaching a
 * child would be a write the user never approved. That, and the honesty of the result
 * when a writable child was asked for and not given, is what these cover.
 */

const def = (name: string, over: Partial<ToolDef> = {}): ToolDef => ({
  name,
  description: name,
  parameters: { type: "object" },
  mutating: false,
  execute: async () => "{}",
  ...over,
});

const CATALOG: ToolDef[] = [
  def("read_file"),
  def("search_code"),
  def("write_file", { mutating: true }),
  def("run_command", { mutating: true }),
  def("builtin_tasks_update", { remote: true }),
  def("spawn_agent"),
];

describe("childToolDefs", () => {
  it("gives a child the read-only local tools", () => {
    expect(childToolDefs(CATALOG).map((t) => t.name)).toEqual(["read_file", "search_code"]);
  });

  it("withholds every mutating tool — a child cannot raise the approval prompt", () => {
    const names = childToolDefs(CATALOG).map((t) => t.name);
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("run_command");
  });

  it("withholds the platform catalog — a delegation is about this workspace", () => {
    expect(childToolDefs(CATALOG).map((t) => t.name)).not.toContain("builtin_tasks_update");
  });

  it("withholds delegation itself, so a child cannot spawn", () => {
    expect(childToolDefs(CATALOG).map((t) => t.name)).not.toContain("spawn_agent");
  });
});

describe("subagentToolDef", () => {
  const streamOf = (...turns: Array<{ text: string; toolCalls?: Array<{ id: string; name: string; args: string }> }>) => {
    let i = 0;
    // The opts parameter is spelled out so a recorded call has a type to read.
    return vi.fn(async (_opts: { tools?: BrainToolSpec[] }) => {
      const t = turns[Math.min(i++, turns.length - 1)]!;
      return { text: t.text, toolCalls: t.toolCalls ?? [], finishReason: "stop" } as never;
    });
  };

  it("takes its name and schema from the shared definition, so both surfaces match", () => {
    const tool = subagentToolDef({ stream: async () => streamOf({ text: "" }), catalog: () => CATALOG });
    expect(tool.name).toBe("spawn_agent");
    expect(tool.mutating).toBe(false);
  });

  it("returns the child's answer and what it cost", async () => {
    const stream = streamOf({ text: "the middleware is in src/auth.ts" });
    const tool = subagentToolDef({ stream: async () => stream as never, catalog: () => CATALOG });
    const out = JSON.parse(await tool.execute({ label: "find auth", task: "find the auth middleware" }, "/repo"));
    // `steps` is the turn the child stopped on — it answered on its first.
    expect(out).toMatchObject({ ok: true, output: "the middleware is in src/auth.ts", steps: 0, readOnly: true });
  });

  it("advertises only the read-only local tools to the child", async () => {
    const stream = streamOf({ text: "done" });
    const tool = subagentToolDef({ stream: async () => stream as never, catalog: () => CATALOG });
    await tool.execute({ label: "look", task: "look" }, "/repo");
    const advertised = stream.mock.calls[0]![0].tools ?? [];
    expect(advertised.map((t) => t.function.name)).toEqual(["read_file", "search_code"]);
  });

  it("runs a child's tool call against the local executor", async () => {
    const read = vi.fn(async () => JSON.stringify({ ok: true, content: "export const x = 1" }));
    const catalog = [def("read_file", { execute: read }), ...CATALOG.slice(1)];
    const stream = streamOf(
      { text: "", toolCalls: [{ id: "c1", name: "read_file", args: JSON.stringify({ path: "src/x.ts" }) }] },
      { text: "x is exported from src/x.ts" },
    );
    const tool = subagentToolDef({ stream: async () => stream as never, catalog: () => catalog });
    const out = JSON.parse(await tool.execute({ label: "read", task: "what does src/x.ts export" }, "/repo"));

    expect(read).toHaveBeenCalledWith({ path: "src/x.ts" }, "/repo");
    expect(out.output).toBe("x is exported from src/x.ts");
  });

  it("says so when a writable child was asked for, rather than silently investigating", async () => {
    const stream = streamOf({ text: "here is what I found" });
    const tool = subagentToolDef({ stream: async () => stream as never, catalog: () => CATALOG });
    const out = JSON.parse(
      await tool.execute({ label: "edit", task: "rename the symbol", read_only: false }, "/repo"),
    );
    expect(out.readOnly).toBe(true);
    expect(out.writeDeclined).toContain("make any change yourself");
  });

  it("refuses an empty brief — the child sees nothing else", async () => {
    const tool = subagentToolDef({ stream: async () => streamOf({ text: "" }) as never, catalog: () => CATALOG });
    const out = JSON.parse(await tool.execute({ label: "x", task: "  " }, "/repo"));
    expect(out).toMatchObject({ ok: false });
    expect(out.error).toContain("task is required");
  });

  it("reports a broken model route to the parent instead of throwing into its run", async () => {
    const tool = subagentToolDef({
      stream: async () => { throw new Error("not signed in"); },
      catalog: () => CATALOG,
    });
    const out = JSON.parse(await tool.execute({ label: "look", task: "look" }, "/repo"));
    expect(out).toMatchObject({ ok: false, error: "not signed in" });
  });
});
