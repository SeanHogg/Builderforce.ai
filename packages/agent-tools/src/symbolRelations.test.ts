import { describe, expect, it } from "vitest";
import { extractSymbols } from "./symbols.js";
import { extractSymbolRelations, MAX_SYMBOL_EDGES_PER_SYMBOL, MAX_CALL_SITES_PER_EDGE, relationsSupported, type SymbolRelation } from "./symbolRelations.js";

const SOURCE = [
  'import { BaseRepo } from "./base.js";',
  'import type { Store, Row } from "./store";',
  'import * as log from "../log";',
  'import { z } from "zod";',
  "",
  "export interface Named extends Store, Other {",
  "  name: string;",
  "}",
  "",
  "export class Cache {",
  "  get(key: string): Row | undefined {",
  "    return undefined;",
  "  }",
  "}",
  "",
  "export class Repo extends BaseRepo<Row> implements Store {",
  "  private readonly cache: Cache;",
  "  constructor(private readonly store: Store) {",
  "    super();",
  "  }",
  "  find(id: string): Row {",
  "    const hit = this.cache.get(id); // a comment: this.nope()",
  "    log.info(\"find(\" + id + \")\");",
  "    this.cache.get(id);",
  "    return this.load(id) ?? helper(id);",
  "  }",
  "  load(id: string): Row {",
  "    return z.parse(id);",
  "  }",
  "}",
  "",
  "function helper(id: string): Row {",
  "  return new Cache().get(id)!;",
  "}",
  "",
].join("\n");

const PATH = "src/repo.ts";
const symbols = extractSymbols(PATH, SOURCE);
const rels = extractSymbolRelations(PATH, SOURCE, symbols);
const nameOf = (i: number): string => { const s = symbols[i]!; return s.container ? `${s.container}.${s.name}` : s.name; };
const show = (r: SymbolRelation): string => {
  const to = "symbol" in r.to ? nameOf(r.to.symbol) : `${r.to.module}:${r.to.name}${r.to.member ? `.${r.to.member}` : ""}`;
  return `${nameOf(r.from)} ${r.kind} ${to}`;
};
const shown = rels.map(show);

describe("extractSymbolRelations", () => {
  it("regression: extends — a class to its base (generics dropped), an interface to each interface it extends", () => {
    expect(shown).toContain("Repo extends ./base.js:BaseRepo");
    expect(shown).toContain("Named extends ./store:Store");
    // `Other` is neither local nor imported: no target is invented.
    expect(shown.some((s) => s.includes("Other"))).toBe(false);
  });

  it("regression: implements — a class to each interface it implements", () => {
    expect(shown).toContain("Repo implements ./store:Store");
  });

  it("regression: composes — a field type and a constructor parameter property", () => {
    expect(shown).toContain("Repo composes Cache");
    expect(shown).toContain("Repo composes ./store:Store");
  });

  it("regression: uses — a type in a signature, never where a stronger relation links the pair", () => {
    expect(shown).toContain("Cache.get uses ./store:Row");
    expect(shown).toContain("Repo.find uses ./store:Row");
    expect(shown).toContain("helper uses Cache");
    expect(shown).not.toContain("Repo uses Cache");
    expect(shown).not.toContain("Repo uses ./store:Store");
  });

  it("regression: calls — this.m(), this.field.m(), ns.f(), f(), package members; sites keep repeats with their order among ALL calls", () => {
    expect(shown).toEqual(expect.arrayContaining([
      "Repo.find calls Cache.get", "Repo.find calls ../log:info", "Repo.find calls Repo.load", "Repo.find calls helper",
      "Repo.load calls zod:z.parse",
    ]));
    const get = rels.find((r) => show(r) === "Repo.find calls Cache.get")!;
    // Calls in find, in source order: cache.get(0) log.info(1) cache.get(2) load(3) helper(4) — the string's "find(" and the comment are no calls.
    expect(get.sites).toEqual([{ path: PATH, line: 22, column: 28, order: 0 }, { path: PATH, line: 24, column: 16, order: 2 }]);
    expect(rels.find((r) => show(r) === "Repo.find calls helper")!.sites!.map((s) => s.order)).toEqual([4]);
    expect(shown.some((s) => s.includes("nope"))).toBe(false);
    // A definition's own name on its line is not a call of itself; `super()` is no call.
    expect(shown.some((s) => /calls (Repo\.find|super)$/.test(s))).toBe(false);
  });

  it("is bounded: one relation per (from, target, kind), capped per symbol and sites per relation", () => {
    const body = Array.from({ length: MAX_SYMBOL_EDGES_PER_SYMBOL + 20 }, (_, i) => `function f${i}() {}`).join("\n");
    const calls = Array.from({ length: MAX_SYMBOL_EDGES_PER_SYMBOL + 20 }, (_, i) => `  f${i}(); f0();`).join("\n");
    const src = `${body}\nexport function main() {\n${calls}\n}\n`;
    const out = extractSymbolRelations("a.ts", src, extractSymbols("a.ts", src));
    const main = out.filter((r) => r.kind === "calls" && "symbol" in r.to && r.from === extractSymbols("a.ts", src).findIndex((s) => s.name === "main"));
    expect(main).toHaveLength(MAX_SYMBOL_EDGES_PER_SYMBOL);
    expect(main.find((r) => "symbol" in r.to && r.to.symbol === 0)!.sites).toHaveLength(MAX_CALL_SITES_PER_EDGE);
  });

  it("regression: a declaration's own type parameters are no heritage — `class A<T extends B> extends C<T>`, `interface I<T extends X>`", () => {
    const src = [
      'import { B, C, X, Y } from "./types";',
      "export class A<T extends B = B> extends C<T> implements Y {",
      "}",
      "export interface I<T extends X, U extends { k: X }> extends Y {",
      "}",
      "export interface J<T extends X> {",
      "}",
      "",
    ].join("\n");
    const syms = extractSymbols("h.ts", src);
    const out = extractSymbolRelations("h.ts", src, syms).filter((r) => r.kind !== "uses")
      .map((r) => `${syms[r.from]!.name} ${r.kind} ${"symbol" in r.to ? syms[r.to.symbol]!.name : r.to.name}`);
    expect(out.sort()).toEqual(["A extends C", "A implements Y", "I extends Y"]);
  });

  it("regression: `a < b && c > (d)` is two comparisons, not a generic call of `a`; `f<T>(x)` still is a call", () => {
    const src = [
      'import { a, f } from "./m";',
      "export function g(b: number, c: number, d: number) {",
      "  if (a < b && c > (d)) return f<number>(d);",
      "}",
      "",
    ].join("\n");
    const syms = extractSymbols("c.ts", src);
    const calls = extractSymbolRelations("c.ts", src, syms).filter((r) => r.kind === "calls");
    expect(calls.map((r) => ("symbol" in r.to ? "" : r.to.name))).toEqual(["f"]);
    expect(calls[0]!.sites![0]!.order).toBe(0);
  });

  it("regression: a local that shadows a definition or an import is no call of it (still counted in order)", () => {
    const src = [
      'import { load } from "./io";',
      'import * as log from "./log";',
      "function helper() { return 1; }",
      "export function run(load: () => void) {",
      "  const helper = () => 2;",
      "  const log = { info() {} };",
      "  helper();",
      "  log.info();",
      "  load();",
      "}",
      "export function real() {",
      "  helper();",
      "  load();",
      "}",
      "",
    ].join("\n");
    const syms = extractSymbols("s.ts", src);
    const rels = extractSymbolRelations("s.ts", src, syms).filter((r) => r.kind === "calls");
    const run = syms.findIndex((s) => s.name === "run"), real = syms.findIndex((s) => s.name === "real");
    expect(rels.filter((r) => r.from === run)).toEqual([]);
    expect(rels.filter((r) => r.from === real).map((r) => ("symbol" in r.to ? syms[r.to.symbol]!.name : r.to.name))).toEqual(["helper", "load"]);
  });

  it("regression: an import written inside a template or a comment is no import", () => {
    const src = [
      "export function emit() {",
      "  return `",
      'import { Danger } from "./danger";',
      "`;",
      "}",
      '// import { Other } from "./other";',
      "export function use() { return Danger(); }",
      "",
    ].join("\n");
    const out = extractSymbolRelations("t.ts", src, extractSymbols("t.ts", src));
    expect(out.filter((r) => !("symbol" in r.to))).toEqual([]);
  });

  it("counts every call of a relation in `count`, while `sites` keeps the first MAX_CALL_SITES_PER_EDGE", () => {
    const body = Array.from({ length: MAX_CALL_SITES_PER_EDGE + 5 }, () => "  f();").join("\n");
    const src = `function f() {}\nexport function main() {\n${body}\n}\n`;
    const rel = extractSymbolRelations("n.ts", src, extractSymbols("n.ts", src)).find((r) => r.kind === "calls")!;
    expect(rel.count).toBe(MAX_CALL_SITES_PER_EDGE + 5);
    expect(rel.sites).toHaveLength(MAX_CALL_SITES_PER_EDGE);
  });

  // regression: hired.video (2026-11-10) — a method whose parameters sit on their own lines (`async respond(\n  status: S,\n): … {`)
  // read each parameter line as a field, so every parameter type became a false `composes`; and a `{ … }` type-literal
  // parameter ended the method's span early, so its calls fell to the class.
  it("reads a multi-line parameter list as the method's parameters, never as fields", () => {
    const src = [
      'import type { Status, Store, Opts } from "./types";',
      "export class Repo {",
      "  constructor(private readonly store: Store) {}",
      "  async respond(",
      "    id: string,",
      "    status: Status,",
      "  ): Promise<void> {",
      "    this.store.put(id);",
      "  }",
      "  async filter<T extends { email: string }>(",
      "    opts: {",
      "      limit: number;",
      "    },",
      "    more: Opts,",
      "  ): Promise<T[]> {",
      "    return this.store.list();",
      "  }",
      "}",
    ].join("\n");
    const symbols = extractSymbols("r.ts", src);
    expect(symbols.filter((s) => s.kind === "method" && s.name !== "constructor").map((s) => `${s.line}:${s.name}`)).toEqual(["4:respond", "10:filter"]);
    const out = extractSymbolRelations("r.ts", src, symbols);
    const composes = out.filter((r) => r.kind === "composes").map((r) => ("symbol" in r.to ? r.to.symbol : r.to.name));
    expect(composes).toEqual(["Store"]);
    const callsOf = (method: string) => out
      .filter((r) => r.kind === "calls" && symbols[r.from]!.name === method)
      .map((r) => ("symbol" in r.to ? r.to.symbol : `${r.to.name}.${r.to.member}`));
    expect(callsOf("respond")).toEqual(["Store.put"]);
    expect(callsOf("filter")).toEqual(["Store.list"]);
    // The parameter types are what the methods use.
    expect(out.filter((r) => r.kind === "uses" && symbols[r.from]!.name === "filter").map((r) => ("symbol" in r.to ? r.to.symbol : r.to.name))).toEqual(["Opts"]);
  });

  // regression: hired.video (2026-11-10) — the calls in a route handler had no owner (channels.ts: 0 call relations from handler bodies).
  it("regression: a route handler's calls are owned by its callback owner, its parameters are locals", () => {
    const src = [
      'import { Hono } from "hono";',
      'import { requireUser } from "./auth";',
      "export const routes = new Hono();",
      'routes.patch("/me/profile-mode", validate(schema), async (c) => {',
      "  const userId = requireUser(c);",
      "  return c.json(setMode(userId));",
      "});",
      "function setMode(id: string) { return id; }",
      "",
    ].join("\n");
    const syms = extractSymbols("src/routes.ts", src);
    const out = extractSymbolRelations("src/routes.ts", src, syms).filter((r) => r.kind === "calls");
    const owner = syms.findIndex((s) => s.name === 'routes.patch "/me/profile-mode"');
    expect(owner).toBeGreaterThanOrEqual(0);
    const calls = out.filter((r) => r.from === owner).map((r) => ("symbol" in r.to ? syms[r.to.symbol]!.name : `${r.to.module}:${r.to.name}`));
    expect(calls).toEqual(["./auth:requireUser", "setMode"]);
    // `c.json(…)`: `c` is the callback's parameter, no edge — but the call is counted in `order`.
    expect(out.find((r) => r.from === owner && "symbol" in r.to)!.sites!.map((s) => s.order)).toEqual([4]);
  });

  // regression: hired.video (2026-11-10) — `new UsersRepository(db).updateById(…)` had a receiver no name typed: no edge.
  it("regression: `new X(…).m(…)` calls X's m (an imported X's member, a local X's method, else the local class X)", () => {
    const src = [
      'import { UsersRepository } from "./users";',
      'import * as repos from "./repos";',
      "class Local {",
      "  run() {",
      "  }",
      "}",
      "export async function setMode(db: unknown) {",
      "  const row = await new UsersRepository(db).updateById(1);",
      "  new Local().run();",
      "  new Local().inherited();",
      "  new repos.Wallet(db).find();",
      "  return row;",
      "}",
      "",
    ].join("\n");
    const syms = extractSymbols("src/s.ts", src);
    const out = extractSymbolRelations("src/s.ts", src, syms).filter((r) => r.kind === "calls");
    const shownCalls = out.map((r) => ("symbol" in r.to ? (syms[r.to.symbol]!.container ? `${syms[r.to.symbol]!.container}.` : "") + syms[r.to.symbol]!.name : `${r.to.module}:${r.to.name}.${r.to.member}`));
    expect(shownCalls).toEqual(["./users:UsersRepository.updateById", "Local.run", "Local", "./repos:Wallet.find"]);
    // The construction `new UsersRepository(db)` is a use of the type, not a call: `updateById` is the body's first call.
    expect(out[0]!.sites).toEqual([{ path: "src/s.ts", line: 8, column: 45, order: 0 }]);
  });

  // regression: hired.video (2026-11-10) — a JSX render `<Comp` was read as a type `uses`; it is an invocation of the component.
  it("regression: a JSX `<Comp` is a `calls` of the component with its site, an intrinsic `<div` is nothing, and no `uses` of it remains", () => {
    const src = [
      'import { Card } from "./card";',
      'import * as Ui from "./ui";',
      "function Row() { return null; }",
      "export function Page({ items }: { items: string[] }) {",
      "  const Icon = pick();",
      "  return (",
      "    <div className=\"x\">",
      "      <Card title=\"a\"><Row /></Card>",
      "      <Ui.Badge />",
      "      <Icon />",
      "    </div>",
      "  );",
      "}",
      "",
    ].join("\n");
    const syms = extractSymbols("src/page.tsx", src);
    const out = extractSymbolRelations("src/page.tsx", src, syms);
    const page = syms.findIndex((s) => s.name === "Page");
    const mine = out.filter((r) => r.from === page);
    const shownMine = mine.map((r) => `${r.kind} ${"symbol" in r.to ? syms[r.to.symbol]!.name : `${r.to.module}:${r.to.name}${r.to.member ? `.${r.to.member}` : ""}`}`);
    // `<div` is intrinsic, `<Icon` a local binding, `</Card>` a closing tag: none is a call.
    expect(shownMine).toEqual(["calls ./card:Card", "calls Row", "calls ./ui:Badge"]);
    expect(mine.find((r) => "module" in r.to && r.to.name === "Card")!.sites).toEqual([{ path: "src/page.tsx", line: 8, column: 8, order: 1 }]);
    // The same tag in a `.ts` file is a type assertion's `<`, never a render.
    expect(extractSymbolRelations("src/page.ts", src, extractSymbols("src/page.ts", src)).some((r) => r.kind === "calls" && "module" in r.to && r.to.name === "Card")).toBe(false);
  });

  it("reads JS/TS only", () => {
    expect(relationsSupported("a.tsx")).toBe(true);
    expect(relationsSupported("a.py")).toBe(false);
    expect(extractSymbolRelations("a.py", "class A(B):\n  pass\n", extractSymbols("a.py", "class A(B):\n  pass\n"))).toEqual([]);
  });
});
