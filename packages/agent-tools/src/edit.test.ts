import { describe, expect, it } from "vitest";
import { applyStringEdit, conformToExistingEol, dominantEol, editedFilesOf, editedPathsOf, editFacts, EDIT_EXCERPT_MAX_LINES } from "./edit.js";

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

describe("applyStringEdit — the file keeps ONE line-ending style", () => {
  const isPureCRLF = (s: string) => !/(^|[^\r])\n/.test(s);
  const RUN = ["export const run = {", "  chatId: input.chatId,", "  tenantId: input.tenantId,", "};", ""].join("\r\n");

  it("regression: a CRLF file edited with LF old/new strings stays pure CRLF with no duplicated lines", () => {
    // chat #60338: a one-line oldString matched LITERALLY, and the two-line LF newString went
    // in as given — an LF line inside agentReplyRun.ts (CRLF), then a duplicated property.
    for (const oldString of ["  chatId: input.chatId,", "  chatId: input.chatId,\n"]) {
      const tail = oldString.endsWith("\n") ? "\n" : "";
      const r = applyStringEdit(RUN, oldString, `  chatId: input.chatId,\n  hostChatId: input.chatId,${tail}`);
      expect(r.ok).toBe(true);
      expect(isPureCRLF(r.content!)).toBe(true);
      expect(r.content!.match(/hostChatId/g)).toHaveLength(1);
      expect(r.content).toBe(RUN.replace("  chatId: input.chatId,", "  chatId: input.chatId,\r\n  hostChatId: input.chatId,"));
    }
  });

  it("matches an old_string that spans lines of an ALREADY-mixed file, and writes the dominant EOL", () => {
    const mixed = "a\r\nb\nc\r\nd\r\n";
    const r = applyStringEdit(mixed, "a\nb\nc", "A\nB\nC");
    expect(r.ok).toBe(true);
    expect(r.content).toBe("A\r\nB\r\nC\r\nd\r\n");
  });

  it("writes an LF new_string into an LF file unchanged, and a CRLF one as LF", () => {
    expect(applyStringEdit(LF, "const b = 2;", "x\r\ny").content).toBe("const a = 1;\nx\ny\nconst c = 3;\n");
  });

  it("a file with no newline keeps none", () => {
    expect(applyStringEdit("abc", "b", "B").content).toBe("aBc");
  });

  it("replaceAll on a CRLF file counts and rewrites every occurrence in CRLF", () => {
    const r = applyStringEdit("x\r\ny\r\nx\r\n", "x\n", "z\nz\n", true);
    expect(r.replaced).toBe(2);
    expect(r.content).toBe("z\r\nz\r\ny\r\nz\r\nz\r\n");
  });

  it("refuses a non-unique match across EOL styles", () => {
    expect(applyStringEdit("x\r\nx\n", "x\n", "y\n").error).toMatch(/not unique/);
  });
});

describe("dominantEol / conformToExistingEol — the whole-file write keeps the file's EOL", () => {
  it("picks the style most lines use, CRLF on a tie, null for no newline", () => {
    expect(dominantEol(CRLF)).toBe("\r\n");
    expect(dominantEol(LF)).toBe("\n");
    expect(dominantEol("a\r\nb\n")).toBe("\r\n");
    expect(dominantEol("a\nb\nc\r\n")).toBe("\n");
    expect(dominantEol("abc")).toBeNull();
  });

  it("rewrites an LF body over a CRLF file to CRLF, and leaves a new file as given", () => {
    expect(conformToExistingEol(CRLF, "one\ntwo\n")).toBe("one\r\ntwo\r\n");
    expect(conformToExistingEol(LF, "one\r\ntwo\r\n")).toBe("one\ntwo\n");
    expect(conformToExistingEol(null, "one\r\ntwo\n")).toBe("one\r\ntwo\n");
    expect(conformToExistingEol("no newline", "one\ntwo")).toBe("one\ntwo");
  });
});

describe("applyStringEdit — what the agent sees after an edit", () => {
  it("returns the edited lines with context, numbered, from the NEW content", () => {
    const file = ["l1", "l2", "l3", "old", "l5", "l6", "l7"].join("\n");
    const r = applyStringEdit(file, "old", "new");
    expect(r.excerpt).toBe(["2: l2", "3: l3", "4: new", "5: l5", "6: l6"].join("\n"));
  });

  it("caps a large edit's excerpt at its head and tail", () => {
    const body = Array.from({ length: 100 }, (_, i) => `n${i}`).join("\n");
    const r = applyStringEdit("top\nOLD\nbottom", "OLD", body);
    const lines = r.excerpt!.split("\n");
    expect(lines.length).toBe(EDIT_EXCERPT_MAX_LINES + 1);
    expect(lines).toContain("…");
  });
});

describe("editFacts — one mapping for every provider", () => {
  it("carries region and excerpt on a hit, and never the file content", () => {
    const facts = editFacts(applyStringEdit(LF, "const b = 2;", "const b = 20;"));
    expect(facts).toEqual({ replaced: 1, region: { startLine: 2, endLine: 2 }, excerpt: expect.stringContaining("2: const b = 20;") });
    expect(facts).not.toHaveProperty("content");
  });

  it("carries the error and the nearest-line hint on a miss", () => {
    // The agent's indentation is wrong, so the literal misses but the line is found.
    const facts = editFacts(applyStringEdit(LF, "  const b = 2;\n  const c = 4;", "x"));
    expect(facts.error).toMatch(/not found/);
    expect(facts.nearest?.line).toBe(2);
  });
});

describe("editedFilesOf", () => {
  it("reads a single edit_file replacement", () => {
    expect(editedFilesOf("edit_file", { path: String.raw`.\src\a.ts`, old_string: "a", new_string: "b" }))
      .toEqual([{ path: "src/a.ts", before: "a", after: "b" }]);
  });
  it("reads every edits[] entry, an entry without a path taking the call's", () => {
    expect(editedFilesOf("edit_file", { path: "src/top.ts", edits: [
      { path: "src/a.ts", old_string: "x", new_string: "y" },
      { old_string: "p", new_string: "q" },
    ] })).toEqual([
      { path: "src/a.ts", before: "x", after: "y" },
      { path: "src/top.ts", before: "p", after: "q" },
    ]);
  });
  it("reads a write_file as after-only, and any other change as its path", () => {
    expect(editedFilesOf("write_file", { path: "src/a.ts", content: "x" })).toEqual([{ path: "src/a.ts", after: "x" }]);
    expect(editedFilesOf("delete_file", { file_path: "src/a.ts" })).toEqual([{ path: "src/a.ts" }]);
    expect(editedFilesOf("edit_file", {})).toEqual([]);
  });
  it("editedPathsOf dedupes", () => {
    expect(editedPathsOf("edit_file", { edits: [
      { path: "a.ts", old_string: "1", new_string: "2" },
      { path: "a.ts", old_string: "3", new_string: "4" },
    ] })).toEqual(["a.ts"]);
  });
});
