/**
 * factIndex.oracle.test.ts — the host-side determinism oracle (PRD 41 §B8.6, H3): seeded sequences of adds, deletes,
 * renames (`b.ts` ⇄ `b/index.ts`, which moves what `./b` resolves to), edits and EOL rewrites, applied INCREMENTALLY to a
 * FactIndex (real tree-sitter facts, resolution against the listing, a structure rule over resolved imports), must dump
 * (`factGraphDump`) byte for byte like a FROM-SCRATCH index of the final tree. The CRLF variant writes the incremental
 * side with CRLF (a Windows `core.autocrlf` checkout) and builds the scratch side LF-only.
 */

import { describe, expect, it } from "vitest";
import { extractFileFacts } from "@builderforce/agent-tools/node-file-facts";
import { defineRule, factGraphDump, type Finding } from "@seanhogg/builderforce-memory/knowledge";
import { createRng, type Rng } from "@seanhogg/builderforce-memory/stats";
import { FactIndex } from "./factIndex";
import { nodeContentHash } from "./nodeSha256";

const SEQUENCES = Number(process.env.FACT_INDEX_ORACLE_SEQUENCES) > 0 ? Math.floor(Number(process.env.FACT_INDEX_ORACLE_SEQUENCES)) : 60;
const STEPS = 6;

/** A structure rule over RESOLVED imports: what a resolution change must rerun. */
const importsResolved = defineRule({
  id: "imports-resolved", version: 1, reads: ["structure"], scope: "file",
  derive: ({ focus, files }): Finding[] => files.get(focus!)!.imports.filter((i) => i.resolved).map((i) => ({
    id: `imports-resolved:${focus}->${i.resolved}`, kind: "imports-resolved", pack: "code", nodes: [], severity: "info", params: {},
  })),
});

const lf = (t: string) => t.replace(/\r\n?/g, "\n");
const crlf = (t: string) => lf(t).replace(/\n/g, "\r\n");
const enc = new TextEncoder();
const hashOf = (text: string) => nodeContentHash(enc.encode(text));
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

function startTree(): Map<string, string> {
  return new Map([
    ["src/a.ts", "import { b } from './b';\nimport { c } from './c';\nexport const a = () => b() + c;\n"],
    ["src/b.ts", "export function b(): number { return 1; }\n"],
    ["src/c.ts", "import { b } from './b';\nexport const c = b();\n"],
    ["src/routes.ts", "import { Hono } from 'hono';\nimport { requireAuth } from './auth';\nconst app = new Hono();\napp.get('/x', requireAuth, (c) => c.text('x'));\n"],
    ["README.md", "# readme\n"],
  ]);
}

function indexOver(tree: () => ReadonlyMap<string, string>): FactIndex {
  return new FactIndex({ rules: [importsResolved], facts: (path) => extractFileFacts(path, tree().get(path) ?? "") });
}

const listingOf = (tree: ReadonlyMap<string, string>) => [...tree].map(([path, text]) => ({ path, hash: hashOf(text) }));

/** One random step; returns the changed paths with their hash now ('' = gone). */
function step(rng: Rng, tree: Map<string, string>, n: number, windows: boolean): Array<{ path: string; hash: string }> {
  const write = (path: string, text: string) => { tree.set(path, windows ? crlf(text) : lf(text)); return { path, hash: hashOf(tree.get(path)!) }; };
  const gone = (path: string) => { tree.delete(path); return { path, hash: "" }; };
  const code = [...tree.keys()].filter((p) => p.endsWith(".ts")).sort();
  switch (Math.floor(rng() * 6)) {
    case 0: { // an edit: a new export or a new import
      const p = pick(rng, code);
      return [write(p, `${lf(tree.get(p)!)}${rng() < 0.5 ? `export const e${n} = ${n};` : `import { x${n} } from './${pick(rng, ["auth", "c", "b", "lib"])}';`}\n`)];
    }
    case 1: return tree.size > 3 ? [gone(pick(rng, code))] : [];
    case 2: return [write(`src/new${n}.ts`, `import { a } from './a';\nexport const n${n} = a;\n`)];
    case 3: { // b.ts ⇄ b/index.ts: './b' now names the other file
      const [from, to] = tree.has("src/b.ts") ? ["src/b.ts", "src/b/index.ts"] : ["src/b/index.ts", "src/b.ts"];
      const text = tree.get(from) ?? "export function b(): number { return 2; }\n";
      return [...(tree.has(from) ? [gone(from)] : []), write(to, text)];
    }
    case 4: return [write("src/auth.ts", "export const requireAuth = () => true;\n")];
    default: { // an EOL rewrite: same normalized content
      const p = pick(rng, code);
      return [write(p, tree.get(p)!)];
    }
  }
}

async function scratchDump(tree: ReadonlyMap<string, string>): Promise<string> {
  const lfTree = new Map([...tree].map(([p, t]) => [p, lf(t)] as const));
  const index = indexOver(() => lfTree);
  await index.sync(listingOf(lfTree));
  return factGraphDump(index.current);
}

async function oracle(windows: boolean): Promise<number> {
  let reused = 0;
  for (let seed = 0; seed < SEQUENCES; seed++) {
    const rng = createRng(seed + (windows ? 10_000 : 0));
    const tree = new Map([...startTree()].map(([p, t]) => [p, windows ? crlf(t) : t] as const));
    const index = indexOver(() => tree);
    await index.sync(listingOf(tree));
    for (let n = 0; n < STEPS; n++) {
      const changed = step(rng, tree, n, windows);
      if (changed.length === 0) continue;
      const u = await index.update(changed);
      reused += u.trace.filter((t) => t.outcome === "reused").length;
    }
    const incremental = factGraphDump(index.current);
    if (incremental !== await scratchDump(tree)) throw new Error(`fact index oracle failed at seed ${seed} (windows: ${windows})`);
  }
  return reused;
}

describe("FactIndex determinism oracle (§B8.6): incremental dump === scratch dump", () => {
  it(`holds over ${SEQUENCES} seeded add / delete / rename / edit sequences`, async () => {
    expect(await oracle(false)).toBeGreaterThan(0);
  }, 120_000);

  it("holds with CRLF on the incremental side and LF on the scratch side (autocrlf)", async () => {
    expect(await oracle(true)).toBeGreaterThan(0);
  }, 120_000);

  it("a rename that moves what `./b` resolves to re-resolves the importers (without re-extracting them)", async () => {
    const tree = startTree();
    let extracted: string[] = [];
    const index = new FactIndex({ rules: [importsResolved], facts: (path) => { extracted.push(path); return extractFileFacts(path, tree.get(path) ?? ""); } });
    await index.sync(listingOf(tree));
    extracted = [];
    const text = tree.get("src/b.ts")!;
    tree.delete("src/b.ts");
    tree.set("src/b/index.ts", text);
    const u = await index.update([{ path: "src/b.ts", hash: "" }, { path: "src/b/index.ts", hash: hashOf(text) }]);
    expect(extracted).toEqual(["src/b/index.ts"]);
    expect(u.changedPaths).toEqual(["src/a.ts", "src/b.ts", "src/b/index.ts", "src/c.ts"]);
    expect(index.findings().map((f) => f.id)).toContain("imports-resolved:src/a.ts->src/b/index.ts");
  });
});
