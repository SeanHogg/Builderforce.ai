import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { srcRef, type Finding } from "@seanhogg/builderforce-memory/knowledge";
import type { FixPorts, StatusEntry, nodeFixPorts } from "./knowledgeFixes";
import { KnowledgeFixSession } from "./knowledgeFixSession";

vi.mock("vscode", async () => (await import("./vscodeL10nMock")).vscodeL10nMock);

type Ports = FixPorts & ReturnType<typeof nodeFixPorts>;

const finding: Finding = { id: "f", kind: "unused-file", pack: "code", nodes: [srcRef("r", "a.ts")], severity: "warn", params: {} };
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

function setup(o: { trusted?: boolean; confirm?: boolean; inHead?: string[]; fixDeletesFile?: boolean } = {}) {
  const files: Record<string, string> = { "a.ts": "blob1" };
  let head = "h1";
  let tree: StatusEntry[] = [];
  const inHead = new Set(o.inHead ?? ["a.ts"]);
  const log: string[] = [];
  const ports = {
    hasHead: async () => true,
    status: async () => [...tree],
    dirtyBuffers: () => [],
    watchSaves: () => ({ stop: () => [] }),
    createBranch: async () => true,
    run: async () => { log.push("run"); tree = [{ code: " M", path: "a.ts" }]; if (o.fixDeletesFile) delete files["a.ts"]; else files["a.ts"] = "blob2"; },
    restore: async (p: string[]) => { log.push(`restore:${p.join(",")}`); },
    remove: async (p: string[]) => { log.push(`remove:${p.join(",")}`); },
    unstage: async (p: string[]) => { log.push(`unstage:${p.join(",")}`); },
    headSha: async () => head,
    hashObjects: async (ps: string[]) => Object.fromEntries(ps.map((p) => [p, files[p] ?? "missing"])),
    inHead: async (ps: string[]) => new Set(ps.filter((p) => inHead.has(p))),
  } as unknown as Ports;
  const confirmScripts = vi.fn(async () => o.confirm ?? true);
  const session = new KnowledgeFixSession({
    trusted: () => o.trusted ?? true,
    untrustedError: () => new Error("untrusted"),
    confirmScripts,
    declinedError: () => new Error("declined"),
    fixPorts: () => ports,
  });
  return { session, files, log, confirmScripts, setHead: (h: string) => { head = h; }, resetTree: () => { tree = []; } };
}

describe("the trust gate and the confirmation", () => {
  it("refuses apply, undo and check in an untrusted workspace, before anything runs", async () => {
    const t = setup({ trusted: false });
    await expect(t.session.apply("r", "/root", finding)).rejects.toThrow("untrusted");
    await expect(t.session.undo("r", "/root", "x")).rejects.toThrow("untrusted");
    await expect(t.session.check("r", "/root", "types")).rejects.toThrow("untrusted");
    expect(t.log).toEqual([]);
    expect(t.confirmScripts).not.toHaveBeenCalled();
  });

  it("asks once per root, and a declined confirmation runs nothing", async () => {
    const t = setup();
    await t.session.apply("r", "/root", finding);
    t.resetTree();
    await t.session.apply("r", "/root", finding);
    expect(t.confirmScripts).toHaveBeenCalledTimes(1);
    const declined = setup({ confirm: false });
    await expect(declined.session.apply("r", "/root", finding)).rejects.toThrow("declined");
    expect(declined.log).toEqual([]);
  });
});

describe("undo is by the host's own record", () => {
  it("applies, returns a fixId, and undoes exactly once", async () => {
    const t = setup();
    const out = await t.session.apply("r", "/root", finding);
    expect(out.fixId).toBeTruthy();
    expect(out.changed).toEqual(["a.ts"]);
    await t.session.undo("r", "/root", out.fixId);
    expect(t.log).toContain("restore:a.ts");
    await expect(t.session.undo("r", "/root", out.fixId)).rejects.toThrow(/already undone/);
  });

  it("refuses an unknown id, a missing id, and another root's id", async () => {
    const t = setup();
    const out = await t.session.apply("r", "/root", finding);
    await expect(t.session.undo("r", "/root", "not-a-fix")).rejects.toThrow(/unknown/);
    await expect(t.session.undo("r", "/root", undefined)).rejects.toThrow(/unknown/);
    await expect(t.session.undo("other", "/root", out.fixId)).rejects.toThrow(/unknown/);
    expect(t.log).not.toContain("restore:a.ts");
  });

  it("refuses when a file diverged, and keeps the id so the person can retry after sorting it out", async () => {
    const t = setup();
    const out = await t.session.apply("r", "/root", finding);
    t.files["a.ts"] = "typed-later";
    await expect(t.session.undo("r", "/root", out.fixId)).rejects.toThrow(/changed since the fix.*a\.ts/);
    expect(t.log.some((l) => l.startsWith("restore"))).toBe(false);
    t.files["a.ts"] = "blob2";
    await t.session.undo("r", "/root", out.fixId);
    expect(t.log).toContain("restore:a.ts");
  });

  it("refuses when HEAD moved", async () => {
    const t = setup();
    const out = await t.session.apply("r", "/root", finding);
    t.setHead("h2");
    await expect(t.session.undo("r", "/root", out.fixId)).rejects.toThrow(/branch moved/);
  });

  it("unstages and deletes a path HEAD does not have, and never restores it", async () => {
    const t = setup({ inHead: [] });
    const out = await t.session.apply("r", "/root", finding);
    await t.session.undo("r", "/root", out.fixId);
    expect(t.log).toContain("unstage:a.ts");
    expect(t.log).toContain("remove:a.ts");
    expect(t.log.some((l) => l.startsWith("restore"))).toBe(false);
  });

  it("reports nothing to undo when no path is left to revert, never a silent success", async () => {
    const t = setup({ inHead: [], fixDeletesFile: true });
    const out = await t.session.apply("r", "/root", finding);
    await expect(t.session.undo("r", "/root", out.fixId)).rejects.toThrow(/Nothing to undo/);
  });
});

describe("checks", () => {
  async function project(scripts: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "kg-session-"));
    dirs.push(root);
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts }));
    return root;
  }

  it("a check with no script never spawns and never asks", async () => {
    const t = setup();
    const root = await project({ build: "node -e \"0\"" });
    expect(await t.session.check("r", root, "types")).toEqual({ status: "skipped" });
    expect(t.confirmScripts).not.toHaveBeenCalled();
  });

  it("runs the script after one confirmation, and refuses a second check while one is running", async () => {
    const t = setup();
    const root = await project({ test: "node -e \"setTimeout(() => {}, 700)\"", typecheck: "node -e \"0\"" });
    const first = t.session.check("r", root, "tests");
    await expect(t.session.check("r", root, "types")).rejects.toThrow(/already running/);
    expect(await first).toEqual({ status: "pass" });
    expect(await t.session.check("r", root, "types")).toEqual({ status: "pass" });
    expect(t.confirmScripts).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("cancel stops the running check and its process tree", async () => {
    const t = setup();
    const root = await project({ typecheck: "node -e \"setInterval(() => {}, 1000)\"" });
    const run = t.session.check("r", root, "types");
    await new Promise((r) => setTimeout(r, 600));
    t.session.cancel("r");
    const out = await run;
    expect(out.status).toBe("fail");
    expect(out.detail).toMatch(/cancelled/);
  }, 30_000);

  it("dispose kills a live check", async () => {
    const t = setup();
    const root = await project({ typecheck: "node -e \"setInterval(() => {}, 1000)\"" });
    const run = t.session.check("r", root, "types");
    await new Promise((r) => setTimeout(r, 600));
    t.session.dispose();
    expect((await run).detail).toMatch(/cancelled/);
  }, 30_000);
});
