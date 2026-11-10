/**
 * factIndex.test.ts — WS4 end to end at the indexer's L2 step (PRD 41 §8 Part B): real tree-sitter FileFacts (agent-tools
 * `extractFileFacts`) into memory's incremental evaluator, with rules declaring what they read.
 *
 *   - a body-only edit reruns the `body`-reading rule (io-in-loop) and skips the `structure`-only rules, file and global;
 *     the step reports `body` + `content`, never `structure`;
 *   - a comment edit reports `content` only and reruns nothing that reads structure or body;
 *   - an autocrlf rewrite (same normalized hash) is no change at all;
 *   - a file without a fact grammar reports `content`; a deletion every kind;
 *   - the near level: files within 2 import hops of a seed.
 */

import { describe, expect, it } from "vitest";
import { defineRule, type Finding } from "@seanhogg/builderforce-memory/knowledge";
import { extractFileFacts } from "@builderforce/agent-tools/node-file-facts";
import { FactIndex } from "./factIndex";
import { nodeContentHash } from "./nodeSha256";

const finding = (id: string): Finding => ({ id, kind: id.split(":")[0]!, pack: "code", nodes: [], severity: "warn", params: {} });

const ioInLoop = defineRule({
  id: "io-in-loop", version: 1, reads: ["body"], scope: "file",
  derive: ({ focus, files }) => files.get(focus!)!.calls.filter((c) => c.inLoop && c.awaited).map((c) => finding(`io-in-loop:${focus}#${c.callee}`)),
});
const exportCount = defineRule({
  id: "export-count", version: 1, reads: ["structure"], scope: "file",
  derive: ({ focus, files }) => [finding(`export-count:${focus}:${files.get(focus!)!.exports.length}`)],
});
const importCycle = defineRule({
  id: "import-cycle", version: 1, reads: ["structure"], scope: "global",
  derive: ({ files }) => [...files].flatMap(([a, f]) => f.imports.filter((i) => i.resolved && files.get(i.resolved)?.imports.some((j) => j.resolved === a) && a < i.resolved).map((i) => finding(`import-cycle:${a}<->${i.resolved}`))),
});
const RULES = [ioInLoop, exportCount, importCycle];

const A = [
  "import { b } from './b';",
  "export async function load(ids: string[]) {",
  "  for (const id of ids) { await db.get(id); }",
  "  return b(ids);",
  "}",
  "",
].join("\n");
const B = "import { load } from './a';\nexport const b = (x: string[]) => x.length;\n";
const C = "import { b } from './b';\nexport const c = 1;\n";

function tree(files: Record<string, string>) {
  const disk = new Map(Object.entries(files));
  const enc = new TextEncoder();
  // Raw facts: the index resolves imports against its listing itself.
  const index = new FactIndex({ rules: RULES, facts: (path) => extractFileFacts(path, disk.get(path) ?? "") });
  const listing = () => [...disk].map(([path, text]) => ({ path, hash: nodeContentHash(enc.encode(text)) }));
  const hashOf = (path: string) => (disk.has(path) ? nodeContentHash(enc.encode(disk.get(path)!)) : "");
  return { disk, index, listing, edit: (path: string, text: string | undefined) => { if (text === undefined) disk.delete(path); else disk.set(path, text); return index.update([{ path, hash: hashOf(path) }]); } };
}

const outcome = (trace: Array<{ rule: string; focus: string; outcome: string }>, rule: string, focus = "") => trace.find((t) => t.rule === rule && t.focus === focus)?.outcome;

describe("FactIndex — the incremental evaluator at L2 (PRD 41 §B1, §B5)", () => {
  it("a first sync extracts every file and runs every rule; the findings are the rules' over real facts", async () => {
    const t = tree({ "src/a.ts": A, "src/b.ts": B, "src/c.ts": C, "README.md": "# hi\n" });
    const first = await t.index.sync(t.listing());
    expect(first.changedKinds).toEqual(["body", "content", "structure"]);
    expect(first.trace.every((e) => e.outcome === "ran")).toBe(true);
    expect(t.index.findings().map((f) => f.id)).toEqual(expect.arrayContaining(["io-in-loop:src/a.ts#db.get", "import-cycle:src/a.ts<->src/b.ts"]));
    expect(t.index.current.manifest.has("README.md")).toBe(false);
  });

  it("a body-only edit reruns io-in-loop and skips the structure-only rules (file and global); kinds = body + content", async () => {
    const t = tree({ "src/a.ts": A, "src/b.ts": B, "src/c.ts": C });
    await t.index.sync(t.listing());
    const step = await t.edit("src/a.ts", A.replace("await db.get(id);", "await db.find(id);"));
    expect(step.changedKinds).toEqual(["body", "content"]);
    expect(step.changedPaths).toEqual(["src/a.ts"]);
    expect(outcome(step.trace, "io-in-loop", "src/a.ts")).toBe("ran");
    expect(outcome(step.trace, "export-count", "src/a.ts")).toBe("reused");
    expect(outcome(step.trace, "import-cycle")).toBe("reused");
    expect(step.trace.filter((e) => e.outcome === "ran").map((e) => `${e.rule}@${e.focus}`)).toEqual(["io-in-loop@src/a.ts"]);
    expect(t.index.findings().map((f) => f.id)).toContain("io-in-loop:src/a.ts#db.find");
  });

  it("a comment edit moves content only: nothing reading structure or body reruns", async () => {
    const t = tree({ "src/a.ts": A, "src/b.ts": B });
    await t.index.sync(t.listing());
    const step = await t.edit("src/b.ts", `// note\n${B}`);
    expect(step.changedKinds).toEqual(["content"]);
    expect(step.trace.every((e) => e.outcome === "reused")).toBe(true);
  });

  it("a structure edit (an import removed) reruns the global structure rule", async () => {
    const t = tree({ "src/a.ts": A, "src/b.ts": B });
    await t.index.sync(t.listing());
    const step = await t.edit("src/b.ts", B.replace("import { load } from './a';\n", ""));
    expect(step.changedKinds).toEqual(["content", "structure"]);
    expect(outcome(step.trace, "import-cycle")).toBe("ran");
    expect(t.index.findings().some((f) => f.kind === "import-cycle")).toBe(false);
  });

  it("autocrlf: a CRLF rewrite of the same content is no change at all", async () => {
    const t = tree({ "src/a.ts": A, "src/b.ts": B });
    await t.index.sync(t.listing());
    const step = await t.edit("src/a.ts", A.replace(/\n/g, "\r\n"));
    expect(step.changedKinds).toEqual([]);
    expect(step.changedPaths).toEqual([]);
    expect(step.trace.every((e) => e.outcome === "reused")).toBe(true);
  });

  it("a file without a fact grammar reports content; a deleted file every kind", async () => {
    const t = tree({ "src/a.ts": A, "src/b.ts": B, "README.md": "# hi\n" });
    await t.index.sync(t.listing());
    expect((await t.edit("README.md", "# hello\n")).changedKinds).toEqual(["content"]);
    const gone = await t.edit("src/b.ts", undefined);
    expect(gone.changedKinds).toEqual(["body", "content", "structure"]);
    expect(t.index.current.manifest.has("src/b.ts")).toBe(false);
  });

  it("sync drops files no longer listed and extracts only what moved", async () => {
    const t = tree({ "src/a.ts": A, "src/b.ts": B, "src/c.ts": C });
    await t.index.sync(t.listing());
    t.disk.delete("src/c.ts");
    const step = await t.index.sync(t.listing());
    expect(step.changedPaths).toEqual(["src/c.ts"]);
    expect(t.index.current.manifest.has("src/c.ts")).toBe(false);
  });

  it("near: files within 2 import hops of the seeds", async () => {
    const t = tree({ "src/a.ts": A, "src/b.ts": B, "src/c.ts": C, "src/d.ts": "export const d = 1;\n" });
    await t.index.sync(t.listing());
    expect([...t.index.near(["src/a.ts"], 2)].sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect([...t.index.near(["src/a.ts"], 1)].sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
