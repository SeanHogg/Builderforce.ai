import { describe, expect, it, vi } from "vitest";
import { srcRef, type Finding } from "@seanhogg/builderforce-memory/knowledge";
import { applyKnipFix, fixBranchName, knipRanOk, parseStatusZ, type FixPorts, type StatusEntry } from "./knowledgeFixes";

vi.mock("vscode", async () => (await import("./vscodeL10nMock")).vscodeL10nMock);

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
  /** Absent = the host has no branch port; true/false = createBranch succeeds/fails. */
  branch?: boolean;
  /** The branch the person is on. */
  on?: string;
  /** switchTo fails (the branch moved or git refused). */
  switchFails?: boolean;
}

function fake(o: Options = {}) {
  let tree: StatusEntry[] = o.before ?? [];
  const log: string[] = [];
  const ports: FixPorts = {
    hasHead: async () => o.head ?? true,
    headSha: async () => "h1",
    hashObjects: async (ps: string[]) => Object.fromEntries(ps.map((p) => [p, "b"])),
    status: async () => (o.statusFails ? undefined : [...tree]),
    dirtyBuffers: () => o.buffers ?? [],
    watchSaves: () => ({ stop: () => o.saves ?? [] }),
    ...(o.branch === undefined ? {} : {
      createBranch: async (name: string) => { log.push(`branch:${name}`); return o.branch ? { ok: true as const } : { ok: false as const, reason: "fatal: a branch named that exists" }; },
      currentBranch: async () => o.on ?? "main",
      switchTo: async (b: string) => { log.push(`switch:${b}`); return o.switchFails ? { ok: false as const, reason: "no" } : { ok: true as const }; },
    }),
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

describe("applyKnipFix - apply to branch", () => {
  it("switches to fix/<kind>-<slug>-<time>-<hash> BEFORE running, and returns the branch", async () => {
    const t = fake({ knip: knipEdits, branch: true });
    const out = await applyKnipFix(t.ports, "r", finding("unused-export", "src/Billing.ts"));
    expect(out.branch).toMatch(/^fix\/unused-export-billing-\d{14}-[a-z0-9]{6,8}$/);
    expect(t.log[0]).toBe(`branch:${out.branch}`);
    expect(t.log[1]).toBe("run");
    expect(out.branchError).toBeUndefined();
  });

  it("applies in place when git cannot switch, and SAYS why (never swallows it)", async () => {
    const t = fake({ knip: knipEdits, branch: false });
    const out = await applyKnipFix(t.ports, "r", finding("unused-export", "a.ts"));
    expect(out.branch).toBeUndefined();
    expect(out.branchError).toBe("fatal: a branch named that exists");
    expect(out.changed).toEqual(["a.ts"]);
  });

  it("applies in place when the host has no branch port", async () => {
    const out = await applyKnipFix(fake({ knip: knipEdits }).ports, "r", finding("unused-file", "a.ts"));
    expect(out.branch).toBeUndefined();
    expect(out.branchError).toBeUndefined();
  });

  it("records the branch the person was on, so undo can return them to it", async () => {
    const t = fake({ knip: knipEdits, branch: true, on: "develop" });
    const seen: { origin?: string }[] = [];
    await applyKnipFix(t.ports, "r", finding("unused-file", "a.ts"), (snapshot) => { seen.push(snapshot); return "id"; });
    expect(seen[0]!.origin).toBe("develop");
  });

  it("records no origin when the fix applied in place", async () => {
    const t = fake({ knip: knipEdits, branch: false });
    const seen: { origin?: string }[] = [];
    await applyKnipFix(t.ports, "r", finding("unused-file", "a.ts"), (snapshot) => { seen.push(snapshot); return "id"; });
    expect(seen[0]!.origin).toBeUndefined();
  });

  it("goes back to the original branch when the codemod fails, and does not delete the fix branch", async () => {
    const t = fake({ knip: knipEdits, branch: true, on: "develop", failRun: new Error("knip could not run") });
    await expect(applyKnipFix(t.ports, "r", finding("unused-file", "a.ts"))).rejects.toThrow(/knip could not run/);
    expect(t.log).toContain("switch:develop");
    expect(t.log.some((l) => l.startsWith("delete"))).toBe(false);
  });

  const withDelete = (t: ReturnType<typeof fake>): FixPorts => ({
    ...t.ports,
    deleteBranch: async (n: string) => { t.log.push(`delete:${n}`); return { ok: true as const }; },
  });

  it("regression: knip changing nothing returns the person to their branch and deletes the empty fix branch", async () => {
    const t = fake({ knip: () => [], branch: true, on: "develop" });
    const out = await applyKnipFix(withDelete(t), "r", finding("unused-file", "a.ts"), () => "id");
    expect(out.changed).toEqual([]);
    expect(out.branch).toBeUndefined();
    expect(out.fixId).toBeUndefined();
    expect(t.log).toContain("switch:develop");
    expect(t.log.some((l) => l.startsWith("delete:fix/"))).toBe(true);
  });

  it("regression: a snapshot that throws reverts the fix, returns to the original branch and deletes the fix branch", async () => {
    const t = fake({ knip: knipEdits, branch: true, on: "develop" });
    const ports: FixPorts = { ...withDelete(t), hashObjects: async () => { throw new Error("hash-object failed"); } };
    await expect(applyKnipFix(ports, "r", finding("unused-export", "a.ts"), () => "id")).rejects.toThrow(/recorded for undo.*hash-object failed/);
    expect(t.log).toContain("restore:a.ts");
    expect(t.log).toContain("switch:develop");
    expect(t.log.some((l) => l.startsWith("delete:fix/"))).toBe(true);
    expect(t.tree()).toEqual([]);
  });

  it("regression: an unreadable HEAD (no snapshot) is treated as no undo record, not a silent success", async () => {
    const t = fake({ knip: knipEdits, branch: true, on: "develop" });
    const ports: FixPorts = { ...withDelete(t), headSha: async () => undefined };
    await expect(applyKnipFix(ports, "r", finding("unused-export", "a.ts"), () => "id")).rejects.toThrow(/recorded for undo/);
    expect(t.log).toContain("switch:develop");
  });

  const hashFails: Pick<FixPorts, "hashObjects"> = { hashObjects: async () => { throw new Error("hash-object failed"); } };
  /** The rejection of an apply that must fail. */
  const rejection = async (run: Promise<unknown>): Promise<Error & { cause?: unknown }> => {
    try {
      await run;
    } catch (error) {
      return error as Error & { cause?: unknown };
    }
    throw new Error("expected the fix to reject");
  };

  it("regression: a revert that fails still leaves the branch, keeps the snapshot error and attaches the revert error as cause", async () => {
    const t = fake({ knip: knipEdits, branch: true, on: "develop" });
    // The strays restore fine; only putting the finding's own file back fails.
    const restore = t.ports.restore;
    const ports: FixPorts = { ...withDelete(t), ...hashFails, restore: async (paths) => { if (paths.includes("a.ts")) throw new Error("checkout locked"); await restore(paths); } };
    const error = await rejection(applyKnipFix(ports, "r", finding("unused-export", "a.ts"), () => "id"));
    expect(error.message).toMatch(/reverting it failed \(checkout locked\).*hash-object failed/);
    expect((error.cause as Error).message).toBe("checkout locked");
    expect(t.log).toContain("switch:develop");
    expect(t.log.some((l) => l.startsWith("delete:fix/"))).toBe(true);
  });

  it("regression: applied in place (no branch), the message does not claim a branch switch", async () => {
    const t = fake({ knip: knipEdits });
    const error = await rejection(applyKnipFix({ ...t.ports, ...hashFails }, "r", finding("unused-export", "a.ts"), () => "id"));
    expect(error.message).toMatch(/so it was reverted: hash-object failed/);
    expect(error.message).not.toMatch(/back on your branch/);
    expect((error.cause as Error).message).toBe("hash-object failed");
  });

  it("regression: when the switch back fails, the message says the person is still on the fix branch", async () => {
    const t = fake({ knip: knipEdits, branch: true, on: "develop", switchFails: true });
    const error = await rejection(applyKnipFix({ ...withDelete(t), ...hashFails }, "r", finding("unused-export", "a.ts"), () => "id"));
    expect(error.message).toMatch(/still on fix\/unused-export-a-/);
    expect(t.log.some((l) => l.startsWith("delete:"))).toBe(false);
  });

  it("names branches safely, apart per finding and per moment", () => {
    const now = new Date("2026-11-06T10:20:30Z");
    const f1 = { id: "one", kind: "unused-file" }, f2 = { id: "two", kind: "unused-file" };
    const w = new Set(["a/B c!.test.ts"]);
    expect(fixBranchName(f1, w, now)).toBe(fixBranchName(f1, w, now)); // deterministic for one moment
    expect(fixBranchName(f1, w, now)).toMatch(/^fix\/unused-file-b-c-test-20261106102030-[a-z0-9]+$/);
    expect(fixBranchName(f1, w, now)).not.toBe(fixBranchName(f2, w, now));
    expect(fixBranchName(f1, w, now)).not.toBe(fixBranchName(f1, w, new Date(now.getTime() + 1000))); // a second try does not collide
    expect(fixBranchName(f1, new Set(), now)).toMatch(/^fix\/unused-file-20261106102030-[a-z0-9]+$/);
  });
});
