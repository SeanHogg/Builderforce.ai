import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileSearchPattern, parseRipgrepLine, ripgrepSearch, searchWorkspace, walkSearch } from "./workspaceSearch";
import { bundledRipgrepCandidates, findRipgrep } from "./ripgrep";

/**
 * `search_code` takes the model's query as a regex — and the model reaches for it with
 * text it just read. `?task=` (from a URL), `foo(bar` (a call site), `a[0]` (an index)
 * all used to come back as "invalid regex: Nothing to repeat", and the agent then
 * spent a whole turn retrying the same words. A query that is not a regex is a literal.
 */
describe("compileSearchPattern", () => {
  it("keeps a valid regex as a regex", () => {
    const re = compileSearchPattern("task=\\d+");
    expect(re.test("?task=2395")).toBe(true);
    expect(re.test("task=abc")).toBe(false);
  });

  it("falls back to a literal match for a query that is not a valid regex", () => {
    expect(compileSearchPattern("?task=").test("/projects?task=2395")).toBe(true);
    expect(compileSearchPattern("?task=").test("/projects?tab=tasks&task=1")).toBe(false);
    expect(compileSearchPattern("foo(bar").test("const x = foo(bar, 1)")).toBe(true);
    expect(compileSearchPattern("a[0").test("return a[0]")).toBe(true);
  });

  it("matches case-insensitively either way", () => {
    expect(compileSearchPattern("?Task=").test("?task=")).toBe(true);
  });
});

describe("parseRipgrepLine", () => {
  it("normalises the POSIX and Windows forms ripgrep prints to one repo-relative path", () => {
    expect(parseRipgrepLine("./src/a.ts:12:  const x = 1;")).toEqual({ path: "src/a.ts", line: 12, text: "const x = 1;" });
    expect(parseRipgrepLine(".\\src\\a.ts:12:  const x = 1;")).toEqual({ path: "src/a.ts", line: 12, text: "const x = 1;" });
    expect(parseRipgrepLine("packages/x/b.ts:3:export interface B {}")).toEqual({ path: "packages/x/b.ts", line: 3, text: "export interface B {}" });
  });

  it("ignores lines that are not matches", () => {
    expect(parseRipgrepLine("")).toBeNull();
    expect(parseRipgrepLine("[Omitted long matching line]")).toBeNull();
  });

  it("keeps a colon inside the matched text", () => {
    expect(parseRipgrepLine("a.ts:1:const m = { key: 'v' };")?.text).toBe("const m = { key: 'v' };");
  });
});

describe("bundledRipgrepCandidates", () => {
  it("names both layouts VS Code has shipped, under the app root", () => {
    const c = bundledRipgrepCandidates("/app", "linux");
    expect(c).toHaveLength(2);
    expect(c[0]).toMatch(/node_modules[\\/]@vscode[\\/]ripgrep[\\/]bin[\\/]rg$/);
    expect(c[1]).toMatch(/node_modules\.asar\.unpacked[\\/]@vscode[\\/]ripgrep[\\/]bin[\\/]rg$/);
    expect(bundledRipgrepCandidates("C:\\app", "win32")[0]).toMatch(/rg\.exe$/);
    expect(bundledRipgrepCandidates(undefined)).toEqual([]);
  });
});

/**
 * The two false negatives measured on chat #101, against a real tree on disk:
 *  - a scope naming a FILE reported the term "not referenced there" (the walker's
 *    readdir threw on the file and the search swallowed it);
 *  - the term was in the workspace but the unscoped walk did not find it.
 */
describe("searchWorkspace on a workspace tree", () => {
  let root = "";
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "bf-search-"));
    await fs.mkdir(path.join(root, "clients", "vscode", "src"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules", "dep"), { recursive: true });
    await fs.mkdir(path.join(root, "api", "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "clients", "vscode", "src", "bfApi.ts"),
      "import x from 'y';\n\nexport interface BfBrainChat {\n  id: number;\n}\n\nexport async function listBrainChats() {}\n",
    );
    await fs.writeFile(path.join(root, "clients", "vscode", "src", "sessionsTree.ts"), "import { BfBrainChat, listBrainChats } from './bfApi';\n");
    await fs.writeFile(path.join(root, "api", "src", "routes.ts"), "router.get('/api/brain/chats', list);\n");
    await fs.writeFile(path.join(root, "node_modules", "dep", "index.js"), "// BfBrainChat should never be found here\n");
  });
  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("searches a FILE scope instead of reporting the term absent", async () => {
    const r = await searchWorkspace({ root, start: path.join(root, "clients", "vscode", "src", "bfApi.ts"), query: "BfBrainChat", ripgrep: null });
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.matches).toEqual([{ path: "clients/vscode/src/bfApi.ts", line: 3, text: "export interface BfBrainChat {" }]);
  });

  it("finds a symbol across the whole tree with the walk, skipping node_modules, in path order", async () => {
    const r = await walkSearch(root, root, "BfBrainChat");
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.matches?.map((m) => `${m.path}:${m.line}`)).toEqual(["clients/vscode/src/bfApi.ts:3", "clients/vscode/src/sessionsTree.ts:1"]);
  });

  it("scopes to a subdirectory", async () => {
    const r = await searchWorkspace({ root, start: path.join(root, "api"), query: "brain/chats", ripgrep: null });
    expect(r.matches).toEqual([{ path: "api/src/routes.ts", line: 1, text: "router.get('/api/brain/chats', list);" }]);
  });

  it("names a missing scope as an error rather than an empty result", async () => {
    const r = await searchWorkspace({ root, start: path.join(root, "nope"), query: "x", ripgrep: null });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("path not found");
  });

  it("agrees with the walk when ripgrep runs the same search", async () => {
    // Only where a ripgrep is actually present (VS Code's bundled one is not visible to
    // vitest, so this exercises `rg` on PATH). Elsewhere the fallback above is the proof.
    const rg = await findRipgrep(undefined);
    if (!rg) return;
    const viaRg = await ripgrepSearch(root, root, "BfBrainChat", rg);
    expect(viaRg).not.toBeNull();
    const viaWalk = await walkSearch(root, root, "BfBrainChat");
    expect(viaRg!.matches).toEqual(viaWalk.matches);
    // A literal that is not a valid regex goes through as a fixed string, not an error.
    const literal = await ripgrepSearch(root, root, "listBrainChats(", rg);
    expect(literal?.matches?.map((m) => m.path)).toEqual(["clients/vscode/src/bfApi.ts"]);
  });
});
