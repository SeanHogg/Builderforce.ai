/**
 * THE L3 key's tree hash is the same for the background indexer and the run delta (PRD 41 §B7): both from git, under
 * git-root-relative names — including a workspace folder that is a sub-folder of the repository.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DeltaAnalyzer } from "@builderforce/agent-tools";
import type { SideFacts } from "@builderforce/run-delta";
import type { PreparedDelta } from "../preparedPorts";
import { indexerL3Binding, placeInRepository } from "./l3Binding";
import { analyzeRepo } from "./repoAnalyzers";
import { gitBlobId, scopeTreeHash } from "./treeHash";

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString();

function repo(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bf-tree-hash-")));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  git(root, "config", "core.autocrlf", "false");
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return root;
}

const facts = (): SideFacts => ({ manifestGeneration: "0", merkleRoot: "m", findings: [], imports: new Map(), badges: new Map(), meta: {} });

describe("the L3 tree hash", { timeout: 120_000 }, () => {
  it("is git's content: committed, dirty or a before text with the same bytes hash the same", async () => {
    const root = repo({ "src/a.ts": "a\n", "src/b.ts": "b\n" });
    const clean = await scopeTreeHash(root, ["."]);
    fs.writeFileSync(path.join(root, "src/a.ts"), "changed\n");
    const dirty = await scopeTreeHash(root, ["."]);
    expect(dirty).not.toBe(clean);
    // The before side of that run (a.ts swapped back to its before text) is the committed tree.
    expect(await scopeTreeHash(root, ["."], new Map([["src/a.ts", "a\n"]]))).toBe(clean);
    expect(gitBlobId("a\n")).toBe(git(root, "rev-parse", "HEAD:src/a.ts").trim());
    // A file the run created is absent on its before side.
    fs.writeFileSync(path.join(root, "src/new.ts"), "n\n");
    expect(await scopeTreeHash(root, ["."], new Map([["src/a.ts", "a\n"], ["src/new.ts", null]]))).toBe(clean);
  });

  it("the indexer (folder = git root) and the run delta key a tool's result IDENTICALLY: the delta's stored result is the indexer's hit", async () => {
    const root = repo({ "package.json": "{}", "src/a.ts": "export const a = 1;\n" });
    fs.writeFileSync(path.join(root, "src/a.ts"), "export const a = 2;\n");
    const prepared: PreparedDelta = {
      input: { runId: "r", mode: "interactive", files: [{ path: "src/a.ts", beforeHash: "b", afterHash: "a", attribution: "run-modified-existing", status: "modified" }] },
      registries: {} as PreparedDelta["registries"],
      texts: { before: [["src/a.ts", { path: "src/a.ts", hash: "b", text: "export const a = 1;\n" }]], after: [["src/a.ts", { path: "src/a.ts", hash: "a", text: "export const a = 2;\n" }]] },
      facts: { before: facts(), after: facts() }, churn: [], pastScores: [],
    };
    const knip: DeltaAnalyzer = { tool: "knip", inputs: ["package.json"], run: async (side) => ({ tool: "knip", version: "5.30.0", status: "ok", findings: [], raw: { side: side.side, files: [], issues: [] } }) };
    await analyzeRepo(root, prepared, {
      analyzers: [knip], entries: () => ({}), bundled: true,
      materialize: async () => ({ dir: root, changedSince: async () => false, dispose: async () => undefined }),
    });
    const binding = indexerL3Binding(root);
    const key = await binding.keyOf("knip");
    expect(key).toBeDefined();
    const hit = await binding.cache.get(key!, "knip");
    expect(hit?.raw).toEqual({ side: "after", files: [], issues: [] }); // the delta's after-side result, under the indexer's key
  });

  it("a workspace folder that is a SUB-folder of the repository hashes its files under git-root names, and never shares an entry with a root-level run", async () => {
    const root = repo({ "package.json": "{}", "sub/package.json": "{}", "sub/a.ts": "a\n", "other/b.ts": "b\n" });
    const folder = path.join(root, "sub");
    const placed = (await placeInRepository(folder))!;
    expect(placed.base).toBe("sub");
    expect(path.resolve(placed.gitRoot)).toBe(path.resolve(root));
    // The folder's tree is the repository's `sub` scope, by the same function and the same names the delta uses.
    const fromFolder = await scopeTreeHash(placed.gitRoot, ["sub"]);
    expect(fromFolder).toBe(await scopeTreeHash(root, ["sub"]));
    expect(fromFolder).not.toBe(await scopeTreeHash(root, ["."]));
    // The indexer's key for the folder differs from a root-level run's (its tool ran in `sub`, its paths are sub-relative).
    const sub = await indexerL3Binding(folder).keyOf("knip");
    const top = await indexerL3Binding(root).keyOf("knip");
    expect(sub).toBeDefined();
    expect(sub).not.toBe(top);
  });
});
