/** The session's finer rules: one pending confirmation per root, going back to the original branch, the preview and the re-scan. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { srcRef, type Finding } from "@seanhogg/builderforce-memory/knowledge";
import type { FixPorts, GitResult, StatusEntry, nodeFixPorts } from "./knowledgeFixes";
import { KnowledgeFixSession } from "./knowledgeFixSession";

vi.mock("vscode", async () => (await import("./vscodeL10nMock")).vscodeL10nMock);

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kg-more-"));
  dirs.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { typecheck: "node -e 0" } }));
  return root;
}

type Ports = FixPorts & ReturnType<typeof nodeFixPorts>;
const finding = (kind = "unused-file", root = "r"): Finding => ({ id: "f", kind, pack: "code", nodes: [srcRef(root, "a.ts")], severity: "warn", params: {} });

function setup(o: { confirm?: () => Promise<boolean>; switchOk?: boolean } = {}) {
  const files: Record<string, string> = { "a.ts": "blob1" };
  let tree: StatusEntry[] = [];
  const log: string[] = [];
  const ok: GitResult = { ok: true };
  const ports = {
    hasHead: async () => true, status: async () => [...tree], dirtyBuffers: () => [], watchSaves: () => ({ stop: () => [] }),
    createBranch: async (n: string) => { log.push(`branch:${n}`); return ok; },
    currentBranch: async () => "develop",
    switchTo: async (b: string) => { log.push(`switch:${b}`); return o.switchOk === false ? { ok: false as const, reason: "local changes" } : ok; },
    run: async () => { tree = [{ code: " M", path: "a.ts" }]; files["a.ts"] = "blob2"; },
    restore: async (p: string[]) => { log.push(`restore:${p.join(",")}`); },
    remove: async () => undefined, unstage: async () => undefined,
    headSha: async () => "h1",
    hashObjects: async (ps: string[]) => Object.fromEntries(ps.map((p) => [p, files[p] ?? "missing"])),
    inHead: async (ps: string[]) => new Set(ps),
  } as unknown as Ports;
  const confirmScripts = vi.fn(o.confirm ?? (async () => true));
  const session = new KnowledgeFixSession({ trusted: () => true, untrustedError: () => new Error("untrusted"), confirmScripts, declinedError: () => new Error("declined"), fixPorts: () => ports });
  return { session, log, confirmScripts, resetTree: () => { tree = []; } };
}

describe("one pending confirmation per root", () => {
  it("shares ONE question between runs that start together, and every one proceeds on a yes", async () => {
    let answer!: (yes: boolean) => void;
    const t = setup({ confirm: () => new Promise<boolean>((resolve) => { answer = resolve; }) });
    const first = t.session.apply("r", "/root", finding());
    const second = t.session.check("r", await project(), "types");
    await Promise.resolve();
    expect(t.confirmScripts).toHaveBeenCalledTimes(1);
    answer(true);
    await first;
    await second;
    expect(t.confirmScripts).toHaveBeenCalledTimes(1); // and asked no more afterwards
  });

  it("a no declines every waiter, and the next run asks again", async () => {
    const answers = [false, true];
    const t = setup({ confirm: async () => answers.shift()! });
    const both = [t.session.apply("r", "/root", finding()), t.session.apply("r", "/root", finding("unused-export"))];
    const outcomes = await Promise.allSettled(both);
    expect(outcomes.map((o) => o.status)).toEqual(["rejected", "rejected"]);
    expect(t.confirmScripts).toHaveBeenCalledTimes(1);
    await t.session.apply("r", "/root", finding());
    expect(t.confirmScripts).toHaveBeenCalledTimes(2);
  });

  it("asks per root", async () => {
    const t = setup();
    await t.session.apply("one", "/root", finding("unused-file", "one"));
    t.resetTree();
    await t.session.apply("two", "/root", finding("unused-file", "two"));
    expect(t.confirmScripts).toHaveBeenCalledTimes(2);
  });
});

describe("undo returns the person to the branch they were on", () => {
  it("switches back after reverting, and leaves the fix branch alone", async () => {
    const t = setup();
    const out = await t.session.apply("r", "/root", finding());
    expect(out.branch).toMatch(/^fix\//);
    await t.session.undo("r", "/root", out.fixId);
    expect(t.log.slice(-2)).toEqual(["restore:a.ts", "switch:develop"]);
    expect(t.log.some((l) => l.startsWith("delete"))).toBe(false);
  });

  it("says so when the switch back fails, and spends the id (the files are already back)", async () => {
    const t = setup({ switchOk: false });
    const out = await t.session.apply("r", "/root", finding());
    await expect(t.session.undo("r", "/root", out.fixId)).rejects.toThrow(/could not be switched back to: local changes/);
    await expect(t.session.undo("r", "/root", out.fixId)).rejects.toThrow(/unknown or was already undone/);
  });
});

describe("the preview and the re-scan", () => {
  it("the preview waits for the person's yes: it never raises a modal on its own", async () => {
    const t = setup();
    expect(await t.session.preview("r", "/root", finding())).toBeNull();
    expect(t.confirmScripts).not.toHaveBeenCalled();
  });

  it("a kind with no codemod has nothing to re-scan: skipped, and nothing asked", async () => {
    const t = setup();
    expect(await t.session.check("r", "/root", "rescan", finding("cycle"))).toEqual({ status: "skipped" });
    expect(await t.session.check("r", "/root", "rescan", undefined)).toEqual({ status: "skipped" });
    expect(t.confirmScripts).not.toHaveBeenCalled();
  });
});
