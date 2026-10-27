import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { treeSitterSymbolExtractor, TREE_SITTER_GRAMMAR_WASMS } from "./node-tree-sitter.js";
import { extractSymbols } from "./symbols.js";

// A method whose parameter list wraps: invisible to the line-anchored regex extractor
// (no `{` on the line that names it), plain to a parse tree.
const TS_SOURCE = [
  "export class Billing {",
  "  async charge(",
  "    card: string,",
  "    cents: number,",
  "  ): Promise<void> {",
  "    return;",
  "  }",
  "}",
  "export function refund(id: string) {}",
  "function helper() {}",
  "export interface Invoice { id: string }",
  "export type Cents = number;",
  "",
].join("\n");

describe("treeSitterSymbolExtractor", () => {
  let emptyDir: string;
  beforeEach(async () => {
    emptyDir = await mkdtemp(join(tmpdir(), "bf-ts-empty-"));
  });
  afterEach(async () => {
    await rm(emptyDir, { recursive: true, force: true });
  });

  it("reads definitions off the parse tree, including a method whose signature wraps", async () => {
    const symbols = await treeSitterSymbolExtractor().extract("src/billing.ts", TS_SOURCE);
    const names = symbols.map((s) => `${s.line}:${s.kind}:${s.name}:${s.exported ? "x" : "-"}`);
    expect(names).toEqual([
      "1:class:Billing:x",
      "2:method:charge:-",
      "9:function:refund:x",
      "10:function:helper:-",
      "11:interface:Invoice:x",
      "12:type:Cents:x",
    ]);
    // The regex extractor misses the wrapped method — the reason this extractor exists.
    expect(extractSymbols("src/billing.ts", TS_SOURCE).some((s) => s.name === "charge")).toBe(false);
  });

  it("parses Python and Go with their own visibility rules", async () => {
    const ex = treeSitterSymbolExtractor();
    const py = await ex.extract("app.py", "class Store:\n    def get(self):\n        pass\n\ndef _private():\n    pass\n");
    expect(py.map((s) => `${s.kind}:${s.name}:${s.exported}`)).toEqual(["class:Store:true", "method:get:true", "function:_private:false"]);
    const go = await ex.extract("main.go", "package main\n\ntype Server struct{}\n\nfunc (s *Server) Run() {}\n\nfunc helper() {}\n");
    expect(go.map((s) => `${s.kind}:${s.name}:${s.exported}`)).toEqual(["struct:Server:true", "method:Run:true", "function:helper:false"]);
  });

  it("falls back to the regex extractor when the grammars are missing", async () => {
    const ex = treeSitterSymbolExtractor({ wasmDir: emptyDir });
    expect(await ex.extract("src/billing.ts", TS_SOURCE)).toEqual(extractSymbols("src/billing.ts", TS_SOURCE));
  });

  it("uses the regex extractor for a language with no grammar, and for an oversized file", async () => {
    const ex = treeSitterSymbolExtractor({ maxParseBytes: 10 });
    const ruby = "class Shop\n  def open\n  end\nend\n";
    expect(await ex.extract("shop.rb", ruby)).toEqual(extractSymbols("shop.rb", ruby));
    expect(await ex.extract("src/billing.ts", TS_SOURCE)).toEqual(extractSymbols("src/billing.ts", TS_SOURCE));
  });

  it("unions in what the TS query cannot see: namespaces / declare module, abstract signatures, export var", async () => {
    const source = [
      "export namespace Billing {",
      "  export function charge() {}",
      "}",
      "declare module \"pricing\" {",
      "  export interface Plan { id: string }",
      "}",
      "export abstract class Gateway {",
      "  abstract connect(url: string): Promise<void>;",
      "  protected abstract close(): void;",
      "}",
      "export var legacyFlag = true;",
      "",
    ].join("\n");
    const symbols = await treeSitterSymbolExtractor().extract("src/gateway.ts", source);
    const names = symbols.map((s) => `${s.line}:${s.kind}:${s.name}:${s.exported ? "x" : "-"}`);
    expect(names).toEqual(expect.arrayContaining([
      "1:module:Billing:x",
      "2:function:charge:x",
      "4:module:pricing:-",
      "5:interface:Plan:x",
      "7:class:Gateway:x",
      "8:method:connect:-",
      "9:method:close:-",
      "11:const:legacyFlag:x",
    ]));
    // Each definition once: the union never duplicates what the parse tree already found.
    expect(new Set(names.map((n) => n.split(":").slice(0, 1).concat(n.split(":")[2]!).join(":"))).size).toBe(names.length);
  });

  it("names the grammar wasm files a bundler must ship", () => {
    expect(TREE_SITTER_GRAMMAR_WASMS).toEqual(expect.arrayContaining(["tree-sitter-typescript.wasm", "tree-sitter-python.wasm", "tree-sitter-c_sharp.wasm"]));
  });
});
