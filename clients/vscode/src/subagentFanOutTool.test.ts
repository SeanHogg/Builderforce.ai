import { describe, expect, it, vi } from "vitest";
import { MAX_WORKSTREAMS, subagentFanOutToolDef } from "./subagentFanOutTool";
import type { ToolDef } from "./fileTools";
import type { SubagentToolDeps } from "./subagentRun";

/**
 * Several children, side by side, in ONE working tree. Chat #126 worked through eight
 * named workstreams one call at a time; this is what lets them run at once — and the
 * scopes are what keep two of them from writing one file.
 */

const def = (name: string, over: Partial<ToolDef> = {}): ToolDef => ({
  name,
  description: name,
  parameters: { type: "object" },
  mutating: false,
  execute: async () => "{}",
  ...over,
});

type Turn = { text: string; toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> };

/** A transport that answers each child from its own script, keyed by the child's task. */
function scriptedStream(scripts: Record<string, Turn[]>, onCall?: (task: string) => void) {
  const seen = new Map<string, number>();
  return vi.fn(async (opts: { messages: Array<{ role: string; content: unknown }>; tools?: unknown[] }) => {
    const task = String(opts.messages.find((m) => m.role === "user")?.content ?? "");
    onCall?.(task);
    const i = seen.get(task) ?? 0;
    seen.set(task, i + 1);
    const turns = scripts[task] ?? [{ text: "done" }];
    const t = turns[Math.min(i, turns.length - 1)]!;
    // The transport hands the kernel a call's arguments as the JSON STRING a provider
    // sends; an object would parse as malformed and arrive as `{}`.
    const toolCalls = (t.toolCalls ?? []).map((c) => ({ ...c, args: JSON.stringify(c.args) }));
    return { text: t.text, toolCalls, finishReason: "stop" } as never;
  });
}

const allow = async () => ({ ok: true }) as const;

function deps(stream: ReturnType<typeof scriptedStream>, catalog: ToolDef[], over: Partial<SubagentToolDeps> = {}): SubagentToolDeps {
  return { stream: async () => stream as never, catalog: () => catalog, run: { confirmWrite: allow }, ...over };
}

const run = async (d: SubagentToolDeps, args: Record<string, unknown>) =>
  JSON.parse(await subagentFanOutToolDef(d).execute(args, "/repo"));

describe("spawn_agents", () => {
  it("starts every workstream before any of them finishes", async () => {
    // Each child's first completion waits until BOTH children have asked — which can
    // only happen if they run concurrently rather than one after another.
    const started: string[] = [];
    let release!: () => void;
    const bothStarted = new Promise<void>((r) => { release = r; });
    const stream = vi.fn(async (opts: { messages: Array<{ role: string; content: unknown }> }) => {
      started.push(String(opts.messages.find((m) => m.role === "user")?.content));
      if (started.length === 2) release();
      await bothStarted;
      return { text: "done", toolCalls: [], finishReason: "stop" } as never;
    });
    const out = await run(deps(stream as never, [def("read_file")]), {
      workstreams: [{ label: "A", task: "look at a" }, { label: "B", task: "look at b" }],
    });
    expect(started.sort()).toEqual(["look at a", "look at b"]);
    expect(out.ok).toBe(true);
    expect(out.workstreams).toHaveLength(2);
  });

  it("refuses a change whose workstreams claim the same path, before starting any", async () => {
    const stream = scriptedStream({});
    const out = await run(deps(stream, [def("read_file")]), {
      read_only: false,
      workstreams: [
        { label: "W1", task: "a", paths: ["api/src/runtime"] },
        { label: "W8", task: "b", paths: ["api/src/runtime/preview.ts"] },
      ],
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("both claim 'api/src/runtime'");
    expect(stream).not.toHaveBeenCalled();
  });

  it("refuses a change with an unscoped workstream", async () => {
    const out = await run(deps(scriptedStream({}), [def("read_file")]), {
      read_only: false,
      workstreams: [{ label: "W2", task: "a" }],
    });
    expect(out.error).toContain("has no paths");
  });

  it("refuses more workstreams than it may start", async () => {
    const workstreams = Array.from({ length: MAX_WORKSTREAMS + 1 }, (_, i) => ({ label: `W${i}`, task: `t${i}` }));
    const out = await run(deps(scriptedStream({}), [def("read_file")]), { workstreams });
    expect(out.error).toContain(`at most ${MAX_WORKSTREAMS}`);
  });

  it("refuses a write outside the child's own paths, and keeps the ones inside", async () => {
    const wrote = vi.fn(async () => JSON.stringify({ ok: true }));
    const stream = scriptedStream({
      "change b": [
        { text: "", toolCalls: [{ id: "1", name: "write_file", args: { path: "web/other.ts", content: "x" } }] },
        { text: "", toolCalls: [{ id: "2", name: "write_file", args: { path: "api/b.ts", content: "y" } }] },
        { text: "changed api/b.ts" },
      ],
    });
    const catalog = [def("read_file"), def("write_file", { mutating: true, execute: wrote })];
    const out = await run(deps(stream, catalog), {
      read_only: false,
      workstreams: [{ label: "B", task: "change b", paths: ["api"], ticket: "2731" }],
    });
    expect(wrote).toHaveBeenCalledTimes(1);
    expect(wrote).toHaveBeenCalledWith({ path: "api/b.ts", content: "y" }, "/repo");
    // The union rides at the top so the parent's backstop opens the ticket.
    expect(out.changedFiles).toEqual(["api/b.ts"]);
    expect(out.workstreams[0]).toMatchObject({ ticket: "2731", role: "code", readOnly: false });
    expect(out.next).toContain("Verify the combined change");
  });

  it("hands a concurrent child no shell and no git", async () => {
    const stream = scriptedStream({});
    const catalog = [
      def("read_file"),
      def("edit_file", { mutating: true }),
      def("run_command", { mutating: true }),
      def("git_commit", { mutating: true }),
      def("spawn_agent"),
      def("builtin_tasks_update", { remote: true }),
    ];
    await run(deps(stream, catalog), { read_only: false, workstreams: [{ label: "A", task: "a", paths: ["src"] }] });
    const advertised = ((stream.mock.calls[0]![0] as { tools?: Array<{ function: { name: string } }> }).tools ?? [])
      .map((t) => t.function.name);
    expect(advertised).toEqual(["read_file", "edit_file"]);
  });

  it("runs read-only, and says so, when the host cannot ask a human", async () => {
    const out = await run(deps(scriptedStream({}), [def("read_file")], { run: {} }), {
      read_only: false,
      workstreams: [{ label: "A", task: "a", paths: ["src"] }],
    });
    expect(out.writeDeclined).toContain("cannot raise an approval prompt");
    expect(out.workstreams[0].readOnly).toBe(true);
  });
});
