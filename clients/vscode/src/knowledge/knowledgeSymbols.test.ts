import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractSymbols } from "@builderforce/agent-tools";
import {
  cleanFileRefs, MAX_REF_LENGTH, MAX_SYMBOL_FILE_BYTES, MAX_SYMBOL_FILES, MAX_SYMBOL_TOTAL_BYTES, recordsOfFile, rootSymbols, SymbolCache, SymbolsGate,
  type SymbolFilePorts,
} from "./knowledgeSymbols";
import type { KnowledgeSymbolRecord } from "./knowledgeProtocol";

const ref = (path: string) => `src:r::${path}`;
const SOURCE = ["export class UseCase {", "  run(): number {", "    return 1;", "  }", "}", "export function helper() { return 2; }", ""].join("\n");

interface FakeFile { text?: string; size?: number; isFile?: boolean; mtimeMs?: number }

/** A disk of named files; `unsafe` paths are refused by the guard the way a link would be. Records every call. */
function disk(files: Record<string, FakeFile | string>, unsafe: string[] = []) {
  const calls: string[] = [];
  const get = (p: string): FakeFile | undefined => {
    const f = files[p.replace(/\\/g, "/").replace(/^.*\/root\//, "")];
    return typeof f === "string" ? { text: f } : f;
  };
  const ports: SymbolFilePorts = {
    guard: async (_root, rel) => { calls.push(`guard ${rel}`); if (unsafe.includes(rel)) throw new Error("link"); },
    stat: async (p) => {
      calls.push(`stat ${p.replace(/\\/g, "/").replace(/^.*\/root\//, "")}`);
      const f = get(p);
      if (!f) throw new Error("ENOENT");
      return { size: f.size ?? Buffer.byteLength(f.text ?? "", "utf8"), isFile: f.isFile ?? true, mtimeMs: f.mtimeMs ?? 1 };
    },
    read: async (p, max) => {
      calls.push(`read ${p.replace(/\\/g, "/").replace(/^.*\/root\//, "")}`);
      const f = get(p);
      if (f?.text === undefined) throw new Error("ENOENT");
      return Buffer.byteLength(f.text, "utf8") > max ? null : f.text;
    },
  };
  return { ports, calls, reads: () => calls.filter((c) => c.startsWith("read ")) };
}

describe("recordsOfFile", () => {
  it("parents a member on its own container, so two classes can each have a run()", () => {
    const text = ["export class A {", "  run() {", "  }", "}", "export class B {", "  run() {", "  }", "}", ""].join("\n");
    const records = recordsOfFile(ref("a.ts"), extractSymbols("a.ts", text));
    expect(records.map((r) => [r.ref, r.parent])).toEqual([
      [`${ref("a.ts")}#A@1`, ref("a.ts")],
      [`${ref("a.ts")}#A.run@2`, `${ref("a.ts")}#A@1`],
      [`${ref("a.ts")}#B@5`, ref("a.ts")],
      [`${ref("a.ts")}#B.run@6`, `${ref("a.ts")}#B@5`],
    ]);
    expect(new Set(records.map((r) => r.ref)).size).toBe(records.length);
  });

  it("parents a Go method on the file when its receiver type is declared elsewhere, and keeps every ref unique", () => {
    const records = recordsOfFile(ref("a.go"), extractSymbols("a.go", ["func (r *Repo) Find() {}", "func (r *Repo) Find() {}", ""].join("\n")));
    expect(records.map((r) => r.parent)).toEqual([ref("a.go"), ref("a.go")]);
    expect(new Set(records.map((r) => r.ref)).size).toBe(2);
  });

  it("carries kind, line and the exported flag", () => {
    const by = Object.fromEntries(recordsOfFile(ref("a.ts"), extractSymbols("a.ts", SOURCE)).map((r) => [r.name, r]));
    expect(by.UseCase).toMatchObject({ kind: "class", line: 1, exported: true });
    expect(by.run).toMatchObject({ kind: "method", line: 2, exported: false });
  });
});

describe("cleanFileRefs: the request is untrusted", () => {
  it("answers nothing for a non-array and drops non-strings, empty and over-long refs", () => {
    for (const bad of ["src:r::a.ts", { length: 3 }, null, undefined, 7, true]) expect(cleanFileRefs(bad)).toEqual([]);
    expect(cleanFileRefs([1, null, {}, [], "", "x".repeat(MAX_REF_LENGTH + 1), ref("a.ts"), ref("a.ts")])).toEqual([ref("a.ts")]);
  });
  it("looks at no more than twice the cap before it dedupes, and keeps at most the cap", () => {
    const huge = Array.from({ length: 200_000 }, (_, i) => ref(`f${i}.ts`));
    const refs = cleanFileRefs(huge);
    expect(refs).toHaveLength(MAX_SYMBOL_FILES);
    expect(refs[0]).toBe(ref("f0.ts"));
    // Past the look-ahead nothing is read: 2x the cap of one repeated ref leaves one.
    expect(cleanFileRefs([...Array.from({ length: MAX_SYMBOL_FILES * 2 }, () => ref("same.ts")), ref("late.ts")])).toEqual([ref("same.ts")]);
  });
});

describe("rootSymbols", () => {
  it("reads each file under the root and answers its definitions", async () => {
    const d = disk({ "a.ts": SOURCE });
    const records = await rootSymbols("/root", "r", [ref("a.ts")], d.ports, new SymbolCache());
    expect(records.map((r) => r.name)).toEqual(["UseCase", "run", "helper"]);
  });

  it("decides on the name before it touches the disk: no stat or read of .env, keys, markdown or sql", async () => {
    const d = disk({ ".env": "KEY=1", "server.pem": "-----", "README.md": "# hi", "schema.sql": "create table t (id int);", "a.ts": SOURCE });
    const records = await rootSymbols("/root", "r", [ref(".env"), ref("server.pem"), ref("README.md"), ref("schema.sql"), ref("a.ts")], d.ports, new SymbolCache());
    expect(records.length).toBeGreaterThan(0);
    expect(d.calls.filter((c) => /\.env|\.pem|\.md|\.sql/.test(c))).toEqual([]);
  });

  it("skips what is unsafe, missing, a foreign ref, a section ref or a way out, and still answers the rest", async () => {
    const d = disk({ "a.ts": SOURCE, "linked.ts": SOURCE }, ["linked.ts"]);
    const refs = [ref("linked.ts"), ref("gone.ts"), "src:other::a.ts", `${ref("a.ts")}#section`, ref("../escape.ts"), ref("%2e%2e/escape.ts"), ref("a.ts")];
    const records = await rootSymbols("/root", "r", refs, d.ports, new SymbolCache());
    expect(new Set(records.map((r) => r.parent.split("#")[0]))).toEqual(new Set([ref("a.ts")]));
    expect(d.reads()).toEqual(["read a.ts"]);
    // `..` never reaches the disk; a percent-encoded name is just a (missing) literal name, never decoded.
    expect(d.calls.some((c) => c.includes("../escape"))).toBe(false);
    expect(d.calls).toContain("guard %2e%2e/escape.ts");
  });

  it("skips anything that is not a regular file, and a file over the cap, without reading it", async () => {
    const d = disk({ "dir.ts": { isFile: false, text: SOURCE }, "big.ts": { size: MAX_SYMBOL_FILE_BYTES + 1, text: SOURCE }, "a.ts": SOURCE });
    const records = await rootSymbols("/root", "r", [ref("dir.ts"), ref("big.ts"), ref("a.ts")], d.ports, new SymbolCache());
    expect(d.reads()).toEqual(["read a.ts"]);
    expect(records.length).toBeGreaterThan(0);
  });

  it("drops a file that grew past the cap after the stat (the bounded read says so)", async () => {
    const d = disk({ "grew.ts": { size: 10, text: "x".repeat(MAX_SYMBOL_FILE_BYTES + 1) } });
    expect(await rootSymbols("/root", "r", [ref("grew.ts")], d.ports, new SymbolCache())).toEqual([]);
  });

  it("asks about at most MAX_SYMBOL_FILES files, once each, whatever the request holds", async () => {
    const files = Object.fromEntries(Array.from({ length: MAX_SYMBOL_FILES + 20 }, (_, i) => [`f${i}.ts`, SOURCE]));
    const d = disk(files);
    await rootSymbols("/root", "r", [...Object.keys(files), "f0.ts"].map(ref), d.ports, new SymbolCache());
    expect(d.reads()).toHaveLength(MAX_SYMBOL_FILES);
  });

  it("stops at the total byte cap at an exact count, with the size checked before every read", async () => {
    const fits = MAX_SYMBOL_TOTAL_BYTES / MAX_SYMBOL_FILE_BYTES;
    const files = Object.fromEntries(Array.from({ length: fits + 5 }, (_, i) => [`h${i}.ts`, { size: MAX_SYMBOL_FILE_BYTES, text: SOURCE }]));
    const d = disk(files);
    await rootSymbols("/root", "r", Object.keys(files).map(ref), d.ports, new SymbolCache());
    expect(d.reads()).toHaveLength(fits);
    // Every read was preceded by its own stat, and the files past the cap were stat'ed but never read.
    d.reads().forEach((read) => expect(d.calls.indexOf(read.replace("read ", "stat "))).toBeLessThan(d.calls.indexOf(read)));
    expect(d.calls.filter((c) => c.startsWith("stat "))).toHaveLength(fits + 5);
  });

  it("answers a repeat from the cache until the file changes", async () => {
    const cache = new SymbolCache();
    const d = disk({ "a.ts": { text: SOURCE, mtimeMs: 1 } });
    await rootSymbols("/root", "r", [ref("a.ts")], d.ports, cache);
    await rootSymbols("/root", "r", [ref("a.ts")], d.ports, cache);
    expect(d.reads()).toHaveLength(1);
    const changed = disk({ "a.ts": { text: SOURCE, mtimeMs: 2 } });
    await rootSymbols("/root", "r", [ref("a.ts")], changed.ports, cache);
    expect(changed.reads()).toHaveLength(1);
  });
});

describe("rootSymbols relations (PRD 43 P0b)", () => {
  const SERVICE = [
    'import { Repo } from "./repo.js";',
    'import { Row } from "./row";',
    'import { z } from "zod";',
    "export class Service {",
    "  constructor(private readonly repo: Repo) {}",
    "  run(id: string): Row {",
    "    this.repo.get(id);",
    "    z.parse(id);",
    "    return this.repo.get(id);",
    "  }",
    "}",
    "",
  ].join("\n");
  const REPO = ["export class Repo {", "  get(id: string) {", "    return id;", "  }", "}", ""].join("\n");

  it("attaches each record's edges: exact refs inside the answer, name-level refs for an unloaded root file, a node_modules terminus for a package", async () => {
    const d = disk({ "src/service.ts": SERVICE, "src/repo.ts": REPO, "src/row.ts": "export interface Row { id: string }\n" });
    const records = await rootSymbols("/root", "r", [ref("src/service.ts"), ref("src/repo.ts")], d.ports, new SymbolCache());
    const by = Object.fromEntries(records.map((r) => [r.ref.replace(/^.*#/, ""), r]));
    expect(by["Service@4"]!.relations).toEqual([{ kind: "composes", to: ref("src/repo.ts#Repo@1") }]);
    expect(by["Service.run@6"]!.relations).toEqual([
      { kind: "uses", to: ref("src/row.ts#Row") },
      { kind: "calls", to: ref("src/repo.ts#Repo.get@2"), sites: [
        { path: "src/service.ts", line: 7, column: 15, order: 0 }, { path: "src/service.ts", line: 9, column: 22, order: 2 },
      ] },
      { kind: "calls", to: ref("node_modules/zod#z.parse"), sites: [{ path: "src/service.ts", line: 8, column: 7, order: 1 }] },
    ]);
    expect(by["Repo@1"]!.relations).toBeUndefined();
  });

  // regression: hired.video (2026-11-10) — `@/lib/…` imports were named as `node_modules/@/…` packages; the nearest tsconfig maps them.
  it("regression: resolves an import by tsconfig path alias to the root's file, an alias of nothing stays a package", async () => {
    const PAGE = [
      'import { Repo } from "@/repo";',
      'import { gone } from "@/gone";',
      "export function page() {",
      "  new Repo().get(1);",
      "  gone();",
      "}",
      "",
    ].join("\n");
    const d = disk({
      "web/tsconfig.json": '{\n  // JSONC\n  "compilerOptions": { "paths": { "@/*": ["./src/*"], }, },\n}',
      "web/src/page.ts": PAGE, "web/src/repo.ts": REPO,
    });
    const records = await rootSymbols("/root", "r", [ref("web/src/page.ts"), ref("web/src/repo.ts")], d.ports, new SymbolCache());
    const page = records.find((r) => r.name === "page")!;
    expect(page.relations).toEqual([
      { kind: "calls", to: ref("web/src/repo.ts#Repo.get@2"), sites: [{ path: "web/src/page.ts", line: 4, column: 14, order: 0 }] },
      // The construction `new Repo()` is a use of the class.
      { kind: "uses", to: ref("web/src/repo.ts#Repo@1") },
      { kind: "calls", to: ref("node_modules/@/gone#gone"), sites: [{ path: "web/src/page.ts", line: 5, column: 3, order: 1 }] },
    ]);
  });
});

describe("SymbolCache", () => {
  it("forgets the least recently used file first", () => {
    const cache = new SymbolCache<KnowledgeSymbolRecord[]>(2);
    const rec: KnowledgeSymbolRecord[] = [];
    cache.set("a", rec); cache.set("b", rec);
    cache.get("a");
    cache.set("c", rec);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(rec);
    expect(cache.size).toBe(2);
  });
});

describe("SymbolsGate", () => {
  const deferred = () => { let done!: (v: KnowledgeSymbolRecord[]) => void; const promise = new Promise<KnowledgeSymbolRecord[]>((r) => { done = r; }); return { promise, done }; };

  it("hands an identical request the call already in flight, so a burst reads once", async () => {
    const gate = new SymbolsGate();
    const first = deferred();
    let runs = 0;
    const task = () => { runs += 1; return first.promise; };
    const a = gate.run("root", [ref("a.ts")], task);
    const b = gate.run("root", [ref("a.ts")], task);
    expect(b).toBe(a);
    first.done([]);
    await Promise.all([a, b]);
    expect(runs).toBe(1);
    await gate.run("root", [ref("a.ts")], task); // settled: a later identical request reads again (the cache answers it)
    expect(runs).toBe(2);
  });

  it("runs a different request on the same root after the first, and different roots side by side", async () => {
    const gate = new SymbolsGate();
    const order: string[] = [];
    const one = deferred();
    const a = gate.run("root", [ref("a.ts")], () => { order.push("a start"); return one.promise.then((v) => { order.push("a end"); return v; }); });
    const b = gate.run("root", [ref("b.ts")], async () => { order.push("b start"); return []; });
    const other = gate.run("other", [ref("c.ts")], async () => { order.push("c start"); return []; });
    await other;
    expect(order).toEqual(["a start", "c start"]);
    one.done([]);
    await Promise.all([a, b]);
    expect(order).toEqual(["a start", "c start", "a end", "b start"]);
  });

  it("keeps going after a failed call", async () => {
    const gate = new SymbolsGate();
    await expect(gate.run("root", [ref("a.ts")], async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await gate.run("root", [ref("b.ts")], async () => [])).toEqual([]);
  });
});

describe("rootSymbols on a real folder", () => {
  let dir = "";
  let outside = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    if (outside) await rm(outside, { recursive: true, force: true });
    dir = ""; outside = "";
  });

  async function folders() {
    dir = await mkdtemp(join(tmpdir(), "kg-symbols-"));
    outside = await mkdtemp(join(tmpdir(), "kg-outside-"));
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "a.ts"), SOURCE);
    await writeFile(join(outside, "secret.ts"), "export function leaked() {}\n");
  }

  it("reads real files and refuses a path that leaves the folder or goes through a link", async () => {
    await folders();
    // A junction needs no privilege on Windows; where links cannot be made the `..` case still holds.
    await symlink(outside, join(dir, "src", "out"), "junction").catch(() => undefined);
    const records = await rootSymbols(dir, "r", [ref("src/a.ts"), ref("../secret.ts"), ref("src/out/secret.ts")], undefined, new SymbolCache());
    expect(records.map((r) => r.name)).toEqual(["UseCase", "run", "helper"]);
    expect(records.some((r) => r.name === "leaked")).toBe(false);
  });

  it("refuses a final file that is itself a link, even to a file outside", async () => {
    await folders();
    const linked = await symlink(join(outside, "secret.ts"), join(dir, "src", "link.ts"), "file").then(() => true, () => false);
    if (!linked) return; // creating a file link needs a privilege this machine does not give
    expect(await rootSymbols(dir, "r", [ref("src/link.ts")], undefined, new SymbolCache())).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("skips a FIFO instead of blocking on it", async () => {
    await folders();
    execFileSync("mkfifo", [join(dir, "src", "pipe.ts")]);
    const records = await rootSymbols(dir, "r", [ref("src/pipe.ts"), ref("src/a.ts")], undefined, new SymbolCache());
    expect(records.map((r) => r.name)).toEqual(["UseCase", "run", "helper"]);
  });
});
