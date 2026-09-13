import { describe, it, expect } from "vitest";
import { extractSymbols, exportedSymbols, formatSymbol, isSymbolIndexable } from "./symbols.js";

const names = (path: string, src: string) => extractSymbols(path, src).map((s) => `${s.line}:${s.kind}:${s.name}${s.exported ? "*" : ""}`);

describe("extractSymbols", () => {
  it("maps a TS module's declarations with their lines and export flags", () => {
    const src = [
      "import x from 'y';",
      "export function buildGitCommand(a: string) {",
      "  const inner = 1;",
      "}",
      "function helper() {}",
      "export interface Opts { a: 1 }",
      "export type Kind = 'a' | 'b';",
      "export const LIMIT = 5;",
      "export default class Service {",
      "  private readonly cache = new Map();",
      "  async find(query: string): Promise<void> {",
      "    if (query) {",
      "    }",
      "  }",
      "}",
      "enum Color { Red }",
    ].join("\n");
    expect(names("src/service.ts", src)).toEqual([
      "2:function:buildGitCommand*",
      "5:function:helper",
      "6:interface:Opts*",
      "7:type:Kind*",
      "8:const:LIMIT*",
      "9:class:Service*",
      "11:method:find",
      "16:enum:Color",
    ]);
  });

  it("does not count nested declarations or control flow as definitions", () => {
    const src = "function outer() {\n  function nested() {}\n  const local = 1;\n  if (x) {\n  }\n}";
    expect(names("a.ts", src)).toEqual(["1:function:outer"]);
  });

  it("covers the other languages the index supports", () => {
    expect(names("m.py", "class Repo:\n    def find(self):\n        pass\ndef _private():\n    pass")).toEqual([
      "1:class:Repo*",
      "2:method:find*",
      "4:function:_private",
    ]);
    expect(names("m.go", "func (r *Repo) Find() {}\nfunc helper() {}\ntype Repo struct {}")).toEqual([
      "1:method:Find*",
      "2:function:helper",
      "3:struct:Repo*",
    ]);
    expect(names("m.rs", "pub fn run() {}\nstruct Inner;\npub trait Tool {}")).toEqual([
      "1:function:run*",
      "2:struct:Inner",
      "3:trait:Tool*",
    ]);
    expect(names("0001.sql", "CREATE TABLE IF NOT EXISTS project_facts (\n  id int\n);\ncreate index idx_facts on project_facts(id);")).toEqual([
      "1:table:project_facts*",
      "4:type:idx_facts*",
    ]);
  });

  it("outlines Markdown by heading, skipping fenced code", () => {
    const src = "# Roadmap\n\n## Consolidated Gap Register\n```\n# not a heading\n```\n### Item";
    expect(names("ROADMAP.md", src)).toEqual([
      "1:heading:# Roadmap*",
      "3:heading:## Consolidated Gap Register*",
      "7:heading:### Item*",
    ]);
  });

  it("knows which files it can index", () => {
    expect(isSymbolIndexable("src/a.tsx")).toBe(true);
    expect(isSymbolIndexable("docs\\ROADMAP.md")).toBe(true);
    expect(isSymbolIndexable("package.json")).toBe(false);
    expect(extractSymbols("image.png", "export const x = 1")).toEqual([]);
  });
});

describe("exportedSymbols", () => {
  it("finds named and default exports in source files", () => {
    const source = "export function Header() {}\nexport const NAV = [];\nexport default App;";
    expect(exportedSymbols("src/App.jsx", source).sort()).toEqual(["Header", "NAV", "default"]);
  });

  it("names a default-exported function and the default itself", () => {
    expect(exportedSymbols("src/App.jsx", "export default function App() {}")).toEqual(["App", "default"]);
  });

  it("ignores non-source files", () => {
    expect(exportedSymbols("package.json", '{"name":"x"}')).toEqual([]);
  });

  it("is stateless between files", () => {
    const source = "export const A = 1;";
    expect(exportedSymbols("a.ts", source)).toEqual(["A"]);
    expect(exportedSymbols("b.ts", source)).toEqual(["A"]);
  });
});

describe("formatSymbol", () => {
  it("renders one compact line per definition", () => {
    expect(formatSymbol({ name: "find", kind: "method", line: 12, exported: false })).toBe("L12 method find");
    expect(formatSymbol({ name: "LIMIT", kind: "const", line: 3, exported: true })).toBe("L3 const LIMIT (export)");
    expect(formatSymbol({ name: "## Gaps", kind: "heading", line: 9, exported: true })).toBe("L9 heading ## Gaps");
  });
});
