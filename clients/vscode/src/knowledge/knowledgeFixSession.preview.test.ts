/** The preview cache: keyed by the tree it was computed on, never shown stale, and a knip failure is logged. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { srcRef, type Finding } from "@seanhogg/builderforce-memory/knowledge";
import type { FixPorts, StatusEntry, nodeFixPorts } from "./knowledgeFixes";

const knip = vi.hoisted(() => ({ calls: 0, fail: false as false | Error, report: { files: ["a.ts"], issues: [] as { file: string }[] } }));

vi.mock("vscode", async () => (await import("./vscodeL10nMock")).vscodeL10nMock);
vi.mock("./knowledgeKnipReport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./knowledgeKnipReport")>()),
  runKnipReport: async () => {
    knip.calls += 1;
    if (knip.fail) throw knip.fail;
    return knip.report;
  },
}));

import { KnowledgeFixSession, treeKey } from "./knowledgeFixSession";

type Ports = FixPorts & ReturnType<typeof nodeFixPorts>;
const finding: Finding = { id: "f", kind: "unused-file", pack: "code", nodes: [srcRef("r", "a.ts")], severity: "warn", params: {} };

function setup() {
  const files: Record<string, string> = { "a.ts": "blob1" };
  let tree: StatusEntry[] = [];
  const logged: string[] = [];
  const ports = {
    hasHead: async () => true,
    status: async () => [...tree],
    dirtyBuffers: () => [],
    watchSaves: () => ({ stop: () => [] }),
    run: async () => { tree = [{ code: " D", path: "a.ts" }]; delete files["a.ts"]; },
    restore: async () => { tree = []; files["a.ts"] = "blob1"; },
    remove: async () => undefined,
    unstage: async () => undefined,
    headSha: async () => "h1",
    hashObjects: async (ps: string[]) => Object.fromEntries(ps.map((p) => [p, files[p] ?? "missing"])),
    inHead: async (ps: string[]) => new Set(ps),
  } as unknown as Ports;
  const session = new KnowledgeFixSession({
    trusted: () => true,
    untrustedError: () => new Error("untrusted"),
    confirmScripts: async () => true,
    declinedError: () => new Error("declined"),
    fixPorts: () => ports,
    log: (line) => logged.push(line),
  });
  return {
    session,
    logged,
    edit: (path: string, blob: string) => { files[path] = blob; tree = [{ code: " M", path }]; },
  };
}

beforeEach(() => {
  knip.calls = 0;
  knip.fail = false;
});

describe("the fix preview cache", () => {
  it("serves an unchanged tree from the cache", async () => {
    const t = setup();
    await t.session.apply("r", "/root", { ...finding, id: "other" }).catch(() => undefined); // grants scripts for the root
    await t.session.preview("r", "/root", finding);
    await t.session.preview("r", "/root", finding);
    expect(knip.calls).toBe(1);
  });

  it("regression: an edit to the tree re-runs knip instead of showing the stale removals", async () => {
    const t = setup();
    await t.session.apply("r", "/root", { ...finding, id: "other" }).catch(() => undefined);
    const before = knip.calls;
    await t.session.preview("r", "/root", finding);
    t.edit("b.ts", "x1");
    await t.session.preview("r", "/root", finding);
    t.edit("b.ts", "x2"); // same status line, different bytes
    await t.session.preview("r", "/root", finding);
    expect(knip.calls - before).toBe(3);
  });

  it("regression: undo drops the root's cached previews", async () => {
    const t = setup();
    const applied = await t.session.apply("r", "/root", finding);
    await t.session.preview("r", "/root", finding);
    const before = knip.calls;
    await t.session.undo("r", "/root", applied.fixId);
    await t.session.preview("r", "/root", finding);
    expect(knip.calls - before).toBe(1);
  });

  it("regression: a knip failure is logged, not swallowed, and answers null", async () => {
    const t = setup();
    await t.session.apply("r", "/root", { ...finding, id: "other" }).catch(() => undefined);
    knip.fail = new Error("knip exploded");
    expect(await t.session.preview("r", "/root", finding)).toBeNull();
    expect(t.logged.some((l) => l.includes("knip exploded"))).toBe(true);
  });

  it("treeKey is null when the host cannot read HEAD (never cached)", async () => {
    expect(await treeKey({ status: async () => [], headSha: async () => undefined, hashObjects: async () => ({}) })).toBeNull();
    expect(await treeKey({ status: async () => [] })).toBeNull();
  });
});
