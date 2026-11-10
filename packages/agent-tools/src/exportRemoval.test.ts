import { describe, expect, it } from "vitest";
import { ExportRemovalRefusal, type ExportRemoval } from "./exportRemoval.js";
import { removeExportFromSource } from "./node-export-remover.js";

/** The real tree-sitter TypeScript grammar (resolved from this package's deps), as the fix uses it. */
const remove = (source: string, name: string, file = "src/a.ts"): Promise<ExportRemoval> => removeExportFromSource(file, source, name);

async function refusal(run: Promise<unknown>): Promise<ExportRemovalRefusal> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ExportRemovalRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("removeExport: a declaration still used in the file", () => {
  it("drops only the `export` keyword and keeps the declaration", async () => {
    const out = await remove("export const helper = 1;\nexport const used = helper + 1;\n", "helper");
    expect(out).toEqual({ action: "unexported", source: "const helper = 1;\nexport const used = helper + 1;\n" });
  });

  it("counts a use as a type", async () => {
    const out = await remove("export interface Shape { x: number }\nexport function area(s: Shape): number { return s.x; }\n", "Shape");
    expect(out).toEqual({ action: "unexported", source: "interface Shape { x: number }\nexport function area(s: Shape): number { return s.x; }\n" });
  });

  it("drops `export` from every overload of a function", async () => {
    const source = "export function f(a: string): string;\nexport function f(a: number): number;\nexport function f(a: any) { return a; }\nf(1);\n";
    const out = await remove(source, "f");
    expect(out.source).toBe("function f(a: string): string;\nfunction f(a: number): number;\nfunction f(a: any) { return a; }\nf(1);\n");
  });
});

describe("removeExport: a declaration with no use in the file", () => {
  it("removes the whole statement with its attached doc comment and the blank line it leaves", async () => {
    const source = 'import x from "y";\n\n/** Doc. */\nexport function gone() {\n  return x;\n}\n\nexport const kept = 2;\n';
    const out = await remove(source, "gone");
    expect(out).toEqual({ action: "removed", source: 'import x from "y";\n\nexport const kept = 2;\n' });
  });

  it("a property named like the export is not a use", async () => {
    const out = await remove("export type T = string;\nconst o = { T: 1 };\nconsole.log(o.T);\n", "T");
    expect(out).toEqual({ action: "removed", source: "const o = { T: 1 };\nconsole.log(o.T);\n" });
  });

  it("a recursive call inside the declaration itself is not a use", async () => {
    const out = await remove("export function loop(n: number): number {\n  return n && loop(n - 1);\n}\nexport const k = 1;\n", "loop");
    expect(out.source).toBe("export const k = 1;\n");
  });

  it("removes one unused declarator of several, leaving the rest exported", async () => {
    expect((await remove("export const a = 1, b = 2;\n", "a")).source).toBe("export const b = 2;\n");
    expect((await remove("export const a = 1, b = 2;\n", "b")).source).toBe("export const a = 1;\n");
  });

  it("keeps a comment that belongs to the code above", async () => {
    const source = "export const a = 1; // about a\nexport const b = 2;\n";
    expect((await remove(source, "b")).source).toBe("export const a = 1; // about a\n");
  });
});

describe("removeExport: a specifier of an export list", () => {
  it("removes one specifier and keeps the others and the declarations", async () => {
    const source = "const a = 1;\nconst b = 2;\nexport { a, b };\n";
    expect(await remove(source, "b")).toEqual({ action: "specifier-removed", source: "const a = 1;\nconst b = 2;\nexport { a };\n" });
    expect((await remove(source, "a")).source).toBe("const a = 1;\nconst b = 2;\nexport { b };\n");
  });

  it("matches the exported (aliased) name, in a re-export too", async () => {
    expect((await remove('export { a as alias, c } from "./x";\n', "alias")).source).toBe('export { c } from "./x";\n');
  });

  it("removes the statement when its only specifier goes", async () => {
    expect((await remove("const a = 1;\nexport { a };\n", "a")).source).toBe("const a = 1;\n");
  });
});

describe("removeExport: two unused exports in one file", () => {
  it("regression: fixing one leaves the other intact (knip --fix removed both)", async () => {
    const source = "export const one = 1;\n\nexport function two() {\n  return 2;\n}\n\nconst three = 3;\nexport { three };\n";
    const first = await remove(source, "one");
    expect(first.source).toBe("export function two() {\n  return 2;\n}\n\nconst three = 3;\nexport { three };\n");
    const second = await remove(first.source, "three");
    expect(second.source).toBe("export function two() {\n  return 2;\n}\n\nconst three = 3;\n");
  });
});

describe("removeExport: refusals leave the file untouched", () => {
  it("a name the file does not export at top level", async () => {
    expect((await refusal(remove("const a = 1;\nexport const b = a;\n", "a"))).code).toBe("not-found");
  });

  it("a file that does not parse cleanly", async () => {
    expect((await refusal(remove("export const a = ;\n", "a"))).code).toBe("unparsed");
  });

  it("a file that is not JavaScript or TypeScript", async () => {
    expect((await refusal(remove("def a(): pass\n", "a", "a.py"))).code).toBe("unparsed");
  });

  it("a destructured export, and a used declarator among several", async () => {
    expect((await refusal(remove("export const { a, b } = obj;\n", "a"))).code).toBe("unsupported");
    expect((await refusal(remove("export const a = 1, b = 2;\nconsole.log(a);\n", "a"))).code).toBe("unsupported");
  });
});

describe("removeExport: grammars", () => {
  it("parses TSX and JavaScript files with their own grammar", async () => {
    expect((await remove("export const View = () => <div />;\nexport const k = 1;\n", "View", "a.tsx")).source).toBe("export const k = 1;\n");
    expect((await remove("export function f() {}\nexport const k = 1;\n", "f", "a.mjs")).source).toBe("export const k = 1;\n");
  });

  it("keeps offsets right after non-ASCII text", async () => {
    expect((await remove("// é — ü\n\nexport const a = 'ö';\nexport const b = 1;\n", "a")).source).toBe("// é — ü\n\nexport const b = 1;\n");
  });
});
