import { describe, expect, it } from "vitest";
import { srcRef, type Finding } from "@seanhogg/builderforce-memory/knowledge";
import { applyKnipFix, knipRanOk, parseStatusZ, type FixPorts, type StatusEntry } from "./knowledgeFixes";

const finding = (kind: string, ...paths: string[]): Finding => ({ id: "f", kind, pack: "code", nodes: paths.map((p) => srcRef("r", p)), severity: "warn", params: {} });

interface Options {
  /** Files in the work tree that differ from HEAD before the run. */
  before?: StatusEntry[];
  /** What knip does to the work tree (status entries it leaves behind). */
  knip?: () => StatusEntry[];
  failRun?: Error;
  head?: boolean;
  statusFails?: boolean;
  buffers?: string[];
  saves?: string[];
  restoreFails?: boolean;
}

function fake(o: Options = {}) {
  let tree: StatusEntry[] = o.before ?? [];
  const log: string[] = [];
  const ports: FixPorts = {
    hasHead: async () => o.head ?? true,
    status: async () => (o.statusFails ? undefined : [...tree]),
    dirtyBuffers: () => o.buffers ?? [],
    watchSaves: () => ({ stop: () => o.saves ?? [] }),
    run: async () => {
      log.push("run");
      if (o.knip) tree = o.knip();
      if (o.failRun) throw o.failRun;
    },
    restore: async (paths) => {
      if (o.restoreFails) throw new Error("checkout failed");
      log.push(`restore:${paths.join(",")}`);
      tree = tree.filter((e) => !paths.includes(e.path));
    },
    remove: async (paths) => { log.push(`remove:${paths.join(",")}`); tree = tree.filter((e) => !paths.includes(e.path)); },
  };
  return { ports, log, tree: () => tree };
}

const knipEdits = (): StatusEntry[] => [
  { code: " M", path: "a.ts" },
  { code: " M", path: "b.ts" },
  { code: " D", path: "c.ts" },
  { code: "??", path: "new.ts" },
];

describe("applyKnipFix - preconditions", () => {
  it("refuses a work tree with untracked files, and never runs knip", async () => {
    const t = fake({ before: [{ code: "??", path: "scratch.ts" }] });
    await expect(applyKnipFix(t.ports, "r", finding("unused-export", "a.ts"))).rejects.toThrow(/Commit or stash/);
    expect(t.log).toEqual([]);
  });

  it("refuses an editor with unsaved changes", async () => {
    const t = fake({ buffers: ["a.ts"] });
    await expect(applyKnipFix(t.ports, "r", finding("unused-export", "a.ts"))).rejects.toThrow(/unsaved/);
    expect(t.log).toEqual([]);
  });

  it("refuses a repository with no HEAD commit", async () => {
    await expect(applyKnipFix(fake({ head: false }).ports, "r", finding("unused-export", "a.ts"))).rejects.toThrow(/no commit/);
  });

  it("refuses when git status cannot be read (a failed read is not clean)", async () => {
    const t = fake({ statusFails: true });
    await expect(applyKnipFix(t.ports, "r", finding("unused-export", "a.ts"))).rejects.toThrow(/could not be read/);
    expect(t.log).toEqual([]);
  });

  it("rejects a kind with no codemod", async () => {
    await expect(applyKnipFix(fake().ports, "r", finding("clone-group", "a.ts"))).rejects.toThrow(/no automatic fix/);
  });
});

describe("applyKnipFix - scoping", () => {
  it("keeps the finding's file, restores stray edits and deletions, deletes files knip created", async () => {
    const t = fake({ knip: knipEdits });
    const out = await applyKnipFix(t.ports, "r", finding("unused-export", "a.ts"));
    expect(out.changed).toEqual(["a.ts"]);
    expect(out.conflicts).toBeUndefined();
    expect(out.note).toMatch(/every unused export/);
    expect(t.log).toEqual(["run", "restore:b.ts,c.ts", "remove:new.ts"]);
  });

  it("keeps a file the person saved during the run and reports it as a conflict", async () => {
    const t = fake({ knip: knipEdits, saves: ["b.ts"] });
    const out = await applyKnipFix(t.ports, "r", finding("unused-export", "a.ts"));
    expect(out.conflicts).toEqual(["b.ts"]);
    expect(t.log).toEqual(["run", "restore:c.ts", "remove:new.ts"]);
  });

  it("restores the strays even when knip crashes mid-way, and still reports the crash", async () => {
    const t = fake({ knip: knipEdits, failRun: new Error("knip could not run") });
    await expect(applyKnipFix(t.ports, "r", finding("unused-export", "a.ts"))).rejects.toThrow(/knip could not run/);
    expect(t.log).toEqual(["run", "restore:b.ts,c.ts", "remove:new.ts"]);
  });

  it("rejects loudly when a restore fails", async () => {
    const t = fake({ knip: knipEdits, restoreFails: true });
    await expect(applyKnipFix(t.ports, "r", finding("unused-export", "a.ts"))).rejects.toThrow(/could not be undone/);
  });

  it("serialises two fixes of the same root", async () => {
    const order: string[] = [];
    const slow = (name: string, ms: number): FixPorts => ({
      ...fake().ports,
      run: async () => { order.push(`${name}:start`); await new Promise((r) => setTimeout(r, ms)); order.push(`${name}:end`); },
    });
    await Promise.all([
      applyKnipFix(slow("one", 20), "r", finding("unused-export", "a.ts")),
      applyKnipFix(slow("two", 1), "r", finding("unused-export", "a.ts")),
    ]);
    expect(order).toEqual(["one:start", "one:end", "two:start", "two:end"]);
  });
});

describe("helpers", () => {
  it("parses porcelain -z, strips the root's prefix and reports a rename's origin", () => {
    expect(parseStatusZ(" M sub/a.ts\0?? sub/new.ts\0R  sub/to.ts\0sub/from.ts\0", "sub/")).toEqual([
      { code: " M", path: "a.ts" },
      { code: "??", path: "new.ts" },
      { code: "R ", path: "to.ts" },
      { code: " D", path: "from.ts" },
    ]);
  });

  it("accepts exit 1 only when knip reported something and nothing failed to launch", () => {
    expect(knipRanOk(0, "", "")).toBe(true);
    expect(knipRanOk(1, "Unused exports (1)", "")).toBe(true);
    expect(knipRanOk(1, "", "npm ERR! 404")).toBe(false);
    expect(knipRanOk(1, "", "")).toBe(false);
    expect(knipRanOk(2, "x", "")).toBe(false);
  });
});
