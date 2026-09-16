import { describe, expect, it, vi } from "vitest";
import { childToolDefs, subagentToolDef } from "./subagentTool";
import type { ToolDef } from "./fileTools";
import type { BrainToolSpec } from "@seanhogg/builderforce-brain-embedded";

/**
 * Delegation on the MACHINE. The child's tool set is the security boundary here, and it
 * turns on ONE thing: whether the host gave the child a way to ask a human. With a gate,
 * a child may write and every write is approved; without one, a mutating tool reaching a
 * child would be a write nobody approved, so it never gets one — and the result says so
 * rather than letting the parent believe an edit was made.
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
  it("gives a child the read-only local tools by default", () => {
    expect(childToolDefs(CATALOG).map((t) => t.name)).toEqual(["read_file", "search_code"]);
  });

  it("withholds every mutating tool unless the delegation is writable", () => {
    const names = childToolDefs(CATALOG).map((t) => t.name);
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("run_command");
  });

  it("hands a WRITABLE child the mutating tools too", () => {
    // The tools a child is handed ARE the boundary: a child that may write is shown the
    // writing tools, and one that may not never sees them.
    expect(childToolDefs(CATALOG, true).map((t) => t.name)).toEqual([
      "read_file", "search_code", "write_file", "run_command",
    ]);
  });

  it("still withholds the platform catalog and delegation from a writable child", () => {
    const names = childToolDefs(CATALOG, true).map((t) => t.name);
    expect(names).not.toContain("builtin_tasks_update");
    expect(names).not.toContain("spawn_agent");
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

  it("falls back to read-only, and SAYS so, when the host cannot ask a human", async () => {
    // The honesty rule: a parent that believes a child made an edit will not make it,
    // and the change would be lost. A host with no `confirmWrite` is exactly that case.
    const stream = streamOf({ text: "here is what I found" });
    const tool = subagentToolDef({ stream: async () => stream as never, catalog: () => CATALOG });
    const out = JSON.parse(
      await tool.execute({ label: "edit", task: "rename the symbol", read_only: false }, "/repo"),
    );
    expect(out.readOnly).toBe(true);
    expect(out.writeDeclined).toContain("cannot raise an approval prompt");
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

  it("runs a WRITABLE child when the host can ask, and asks before each write", async () => {
    const confirmWrite = vi.fn(async () => ({ ok: true }) as const);
    const wrote = vi.fn(async () => JSON.stringify({ ok: true }));
    const catalog = [def("read_file"), def("write_file", { mutating: true, execute: wrote })];
    const tool = subagentToolDef({
      stream: async () => streamOf(
        { text: "", toolCalls: [{ id: "c1", name: "write_file", args: JSON.stringify({ path: "a.ts" }) }] },
        { text: "done" },
      ) as never,
      catalog: () => catalog,
      confirmWrite,
    });
    const out = JSON.parse(await tool.execute({ label: "edit", task: "rename it", read_only: false }, "/repo"));

    expect(confirmWrite).toHaveBeenCalledWith({ name: "write_file", args: { path: "a.ts" } });
    expect(wrote).toHaveBeenCalled();
    expect(out).toMatchObject({ ok: true, readOnly: false });
    // Nothing to warn the parent about: it asked for a writable child and got one.
    expect(out.writeDeclined).toBeUndefined();
  });

  it("does not execute a write the human declined, and tells the child why", async () => {
    const wrote = vi.fn(async () => JSON.stringify({ ok: true }));
    const catalog = [def("read_file"), def("write_file", { mutating: true, execute: wrote })];
    const tool = subagentToolDef({
      stream: async () => streamOf(
        { text: "", toolCalls: [{ id: "c1", name: "write_file", args: JSON.stringify({ path: "a.ts" }) }] },
        { text: "could not change it" },
      ) as never,
      catalog: () => catalog,
      confirmWrite: async () => ({ ok: false, reason: "declined by the user" }),
    });
    const out = JSON.parse(await tool.execute({ label: "edit", task: "rename it", read_only: false }, "/repo"));

    // A refusal is an ordinary tool result the child adapts to, not a dead delegation.
    expect(wrote).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: true });
  });

  /**
   * A slice the Brain does HERE instead of dispatching it is work nobody owns: no agent
   * on the ticket, nothing in anyone's queue, and a user who cannot tell who did what.
   * `as_agent` keeps the accountability a dispatch would have carried.
   */
  describe("as_agent — running a slice in a team agent's persona", () => {
    const ADA = { ref: "agent_12", name: "Ada", brief: "Backend Engineer — owns the auth and billing services." };

    it("resolves the persona, prefixes the label and names the agent in the result", async () => {
      const personaBrief = vi.fn(async () => ADA);
      const stream = streamOf({ text: "ported it" });
      const tool = subagentToolDef({
        stream: async () => stream as never,
        catalog: () => CATALOG,
        personaBrief,
      });
      const out = JSON.parse(
        await tool.execute({ label: "port the auth middleware", task: "port it", as_agent: "Ada" }, "/repo"),
      );

      expect(personaBrief).toHaveBeenCalledWith("Ada");
      // The timeline row says WHO, not just what.
      expect(out.label).toBe("as Ada: port the auth middleware");
      expect(out.asAgent).toEqual({ ref: "agent_12", name: "Ada" });
      expect(out.ok).toBe(true);
    });

    it("refuses an agent this workspace does not have, and runs no child", async () => {
      // Running it anonymously would make the parent's "Ada did this" report false.
      const stream = streamOf({ text: "should never run" });
      const tool = subagentToolDef({
        stream: async () => stream as never,
        catalog: () => CATALOG,
        personaBrief: async () => null,
      });
      const out = JSON.parse(
        await tool.execute({ label: "port it", task: "port it", as_agent: "Nobody" }, "/repo"),
      );

      expect(out.ok).toBe(false);
      expect(out.error).toContain("no agent named 'Nobody' in this workspace");
      // The refusal names the tools that list the REAL agents, so the next turn can fix it.
      expect(out.error).toContain("builtin_chats_list_agents");
      expect(out.error).toContain("builtin_cloud_agents_list_mine");
      expect(stream).not.toHaveBeenCalled();
    });

    it("refuses when the host cannot name personas at all", async () => {
      const stream = streamOf({ text: "should never run" });
      const tool = subagentToolDef({ stream: async () => stream as never, catalog: () => CATALOG });
      const out = JSON.parse(await tool.execute({ label: "port it", task: "port it", as_agent: "Ada" }, "/repo"));
      expect(out.ok).toBe(false);
      expect(stream).not.toHaveBeenCalled();
    });

    it("leaves an ordinary delegation untouched", async () => {
      const personaBrief = vi.fn(async () => ADA);
      const stream = streamOf({ text: "found it" });
      const tool = subagentToolDef({ stream: async () => stream as never, catalog: () => CATALOG, personaBrief });
      const out = JSON.parse(await tool.execute({ label: "look", task: "find it" }, "/repo"));
      expect(personaBrief).not.toHaveBeenCalled();
      expect(out.label).toBe("look");
      expect(out.asAgent).toBeUndefined();
    });
  });

  it("asks for nothing when the child only reads, even on a writable delegation", async () => {
    const confirmWrite = vi.fn(async () => ({ ok: true }) as const);
    const tool = subagentToolDef({
      stream: async () => streamOf(
        { text: "", toolCalls: [{ id: "c1", name: "read_file", args: JSON.stringify({ path: "a.ts" }) }] },
        { text: "found it" },
      ) as never,
      catalog: () => CATALOG,
      confirmWrite,
    });
    await tool.execute({ label: "look", task: "find it", read_only: false }, "/repo");
    expect(confirmWrite).not.toHaveBeenCalled();
  });
});
