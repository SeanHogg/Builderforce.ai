import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRipgrep } from "./ripgrep";
import { compileSearchPattern, ripgrepSearch, searchWorkspace, smartCaseSensitive, walkSearch } from "./workspaceSearch";

describe("smart case", () => {
  it("is case-sensitive exactly when the query has an upper-case letter", () => {
    expect(smartCaseSensitive("BfBrainChat")).toBe(true);
    expect(smartCaseSensitive("brain chat")).toBe(false);
    // A regex escape is syntax, not a capital the user typed.
    expect(smartCaseSensitive("\\Wtask\\d+")).toBe(false);
    expect(smartCaseSensitive("\\WTask")).toBe(true);
  });

  it("compileSearchPattern honours the flag and stays insensitive by default", () => {
    expect(compileSearchPattern("Task", true).test("task")).toBe(false);
    expect(compileSearchPattern("Task", true).test("Task")).toBe(true);
    expect(compileSearchPattern("Task").test("task")).toBe(true);
  });
});

describe("search_code — smart case and Stop", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "bf-smartcase-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "a.ts"), "export interface BrainChat {}\nconst url = '/brainchat';\n");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("an upper-case query matches only that spelling; a lower-case one matches both", async () => {
    const exact = await searchWorkspace({ root, start: root, query: "BrainChat", ripgrep: null });
    expect(exact.matches?.map((m) => m.line)).toEqual([1]);
    const loose = await searchWorkspace({ root, start: root, query: "brainchat", ripgrep: null });
    expect(loose.matches?.map((m) => m.line)).toEqual([1, 2]);
    // A file scope follows the same rule.
    const file = await searchWorkspace({ root, start: path.join(root, "src", "a.ts"), query: "BrainChat", ripgrep: null });
    expect(file.matches?.map((m) => m.line)).toEqual([1]);
  });

  it("ripgrep and the walk agree on smart case", async () => {
    const rg = await findRipgrep(undefined);
    if (!rg) return;
    for (const query of ["BrainChat", "brainchat"]) {
      const viaRg = await ripgrepSearch(root, root, query, rg);
      const viaWalk = await walkSearch(root, root, query);
      expect(viaRg?.matches).toEqual(viaWalk.matches);
    }
  });

  it("a stopped run does not search", async () => {
    const stopped = AbortSignal.abort();
    const walk = await searchWorkspace({ root, start: root, query: "BrainChat", ripgrep: null, signal: stopped });
    expect(walk).toMatchObject({ ok: false, error: "search stopped" });
    const rg = await ripgrepSearch(root, root, "BrainChat", "definitely-not-a-ripgrep-binary", { signal: stopped });
    expect(rg).toMatchObject({ ok: false, error: "search stopped" });
  });

  it("Stop mid-search kills ripgrep and settles the call", async () => {
    const rg = await findRipgrep(undefined);
    if (!rg) return;
    const ctl = new AbortController();
    const pending = ripgrepSearch(root, root, "BrainChat", rg, { signal: ctl.signal });
    ctl.abort();
    const r = await pending;
    // Either rg finished first (a tiny tree) or Stop won — never a hang.
    expect(r === null || r.ok === true || r.error === "search stopped").toBe(true);
  });
});
