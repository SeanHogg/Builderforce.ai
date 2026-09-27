import { describe, expect, it } from "vitest";
import { applyStringEdit } from "./edit.js";

const LF = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
const CRLF = LF.replace(/\n/g, "\r\n");

describe("applyStringEdit", () => {
  it("replaces a unique literal match and reports the count", () => {
    const r = applyStringEdit(LF, "const b = 2;", "const b = 20;");
    expect(r.ok).toBe(true);
    expect(r.replaced).toBe(1);
    expect(r.content).toBe("const a = 1;\nconst b = 20;\nconst c = 3;\n");
  });

  it("matches an LF oldString against a CRLF file and PRESERVES the file's line endings", () => {
    // The whole reason this helper exists: models emit \n even for CRLF files.
    const r = applyStringEdit(CRLF, "const a = 1;\nconst b = 2;", "const a = 9;\nconst b = 8;");
    expect(r.ok).toBe(true);
    // Every surviving line ending is still CRLF — no whole-file EOL rewrite.
    expect(r.content).toBe("const a = 9;\r\nconst b = 8;\r\nconst c = 3;\r\n");
    expect(r.content).not.toMatch(/[^\r]\n/);
  });

  it("matches a CRLF oldString against an LF file and writes back LF", () => {
    const r = applyStringEdit(LF, "const a = 1;\r\nconst b = 2;", "const a = 9;\r\nconst b = 8;");
    expect(r.ok).toBe(true);
    expect(r.content).toBe("const a = 9;\nconst b = 8;\nconst c = 3;\n");
  });

  it("refuses a non-unique oldString rather than editing an arbitrary occurrence", () => {
    const r = applyStringEdit("x = 1;\nx = 1;\n", "x = 1;", "x = 2;");
    expect(r.ok).toBe(false);
    expect(r.content).toBeUndefined();
    expect(r.error).toMatch(/not unique/);
  });

  it("replaces every occurrence with replaceAll and counts them", () => {
    const r = applyStringEdit("x = 1;\nx = 1;\nx = 1;\n", "x = 1;", "x = 2;", true);
    expect(r.ok).toBe(true);
    expect(r.replaced).toBe(3);
    expect(r.content).toBe("x = 2;\nx = 2;\nx = 2;\n");
  });

  it("reports a miss with actionable guidance instead of a silent no-op", () => {
    const r = applyStringEdit(LF, "const zz = 0;", "const zz = 1;");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
    expect(r.error).toMatch(/read_file/);
  });

  it("rejects an empty oldString (would otherwise match everywhere)", () => {
    expect(applyStringEdit(LF, "", "x").ok).toBe(false);
    expect(applyStringEdit(LF, "", "x").error).toMatch(/required/);
  });

  it("points a miss at the nearest line with a numbered ±3 excerpt", () => {
    const file = "l1\nl2\nl3\nfunction go() {\n  return 1;\n}\nl7\nl8\n";
    // First line matches (trimmed) but the body does not — the usual agent failure.
    const r = applyStringEdit(file, "  function go() {\n  return 2;\n}", "x");
    expect(r.ok).toBe(false);
    expect(r.nearest).toEqual({
      line: 4,
      excerpt: "1: l1\n2: l2\n3: l3\n4: function go() {\n5:   return 1;\n6: }\n7: l7",
    });
  });

  it("falls back to a containing line for a long enough needle", () => {
    const r = applyStringEdit("a\nconst value = compute(1);\nb\n", "value = compute(1);\nnext();", "x");
    expect(r.nearest?.line).toBe(2);
  });

  it("carries no nearest when nothing resembles oldString, nor on a non-unique miss", () => {
    expect(applyStringEdit(LF, "const zz = 0;", "x").nearest).toBeUndefined();
    expect(applyStringEdit("x = 1;\nx = 1;\n", "x = 1;", "x = 2;").nearest).toBeUndefined();
  });

  it("reports the region of a single-line replacement", () => {
    const r = applyStringEdit(LF, "const b = 2;", "const b = 20;");
    expect(r.region).toEqual({ startLine: 2, endLine: 2 });
  });

  it("reports the region of a multi-line replacement in the NEW content", () => {
    const r = applyStringEdit(LF, "const b = 2;", "const b = 2;\nconst b2 = 22;\nconst b3 = 23;");
    expect(r.region).toEqual({ startLine: 2, endLine: 4 });
    expect(r.content?.split("\n")[3]).toBe("const b3 = 23;");
  });

  it("reports a correct region against a CRLF file", () => {
    const r = applyStringEdit(CRLF, "const b = 2;\nconst c = 3;", "const b = 9;\nconst c = 8;\nconst d = 7;");
    expect(r.ok).toBe(true);
    expect(r.region).toEqual({ startLine: 2, endLine: 4 });
  });

  it("leaves the rest of the file byte-identical", () => {
    const before = "line1\n\tindented\nline3\n";
    const r = applyStringEdit(before, "\tindented", "\tINDENTED");
    expect(r.content).toBe("line1\n\tINDENTED\nline3\n");
  });
});
