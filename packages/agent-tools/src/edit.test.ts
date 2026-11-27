import { describe, expect, it } from "vitest";
import { applyBatchEdits, applyStringEdit, conformToExistingEol, planBatchEdits, dominantEol, editedFilesOf, editedPathsOf, editFacts, EDIT_EXCERPT_MAX_LINES } from "./edit.js";

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

describe("applyStringEdit — a leading BOM neither blocks a match nor is lost", () => {
  const BOM = String.fromCharCode(0xfeff);

  it("matches the first line of a BOM file and writes the BOM back", () => {
    const r = applyStringEdit(`${BOM}alpha\r\nbeta\r\n`, "alpha", "gamma");
    expect(r.ok).toBe(true);
    expect(r.content).toBe(`${BOM}gamma\r\nbeta\r\n`);
  });

  it("keeps the BOM when the edit is further down, and reports a miss without it", () => {
    expect(applyStringEdit(`${BOM}a\nb\n`, "b", "c").content).toBe(`${BOM}a\nc\n`);
    expect(applyStringEdit(`${BOM}a\nb\n`, "zzz", "c").ok).toBe(false);
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

describe("applyStringEdit — tolerant tiers after exact/CRLF", () => {
  it("names the tier: exact on a literal hit, crlf when only line endings differed", () => {
    expect(applyStringEdit(LF, "const b = 2;", "x").matchedBy).toBe("exact");
    expect(applyStringEdit(CRLF, "const a = 1;\nconst b = 2;", "x").matchedBy).toBe("crlf");
  });

  it("unescaped: repairs an over-escaped oldString and unescapes newString the same way", () => {
    const r = applyStringEdit('const s = "hi";\nconst t = 1;\n', 'const s = \\"hi\\";\\nconst t', 'const s = \\"bye\\";\\nconst u = 2;\\nconst t');
    expect(r.ok).toBe(true);
    expect(r.matchedBy).toBe("unescaped");
    expect(r.content).toBe('const s = "bye";\nconst u = 2;\nconst t = 1;\n');
  });

  it("unescaped: skipped when the file itself uses the escape sequence", () => {
    const r = applyStringEdit('a = "x\\"y";\nb = "q";\n', 'b = \\"q\\";', "b = 1;");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
  });

  it("unescaped: newString keeps every escape kind oldString did not over-use", () => {
    // oldString over-escaped only quotes; the `\n` inside the new log string is real source text.
    const r = applyStringEdit('say("hi");\n', 'say(\\"hi\\");', 'say(\\"hi\\");\nlog(\\"x\\n\\");');
    expect(r.matchedBy).toBe("unescaped");
    expect(r.content).toBe('say("hi");\nlog("x\\n");\n');
  });

  it("unescaped: a kind the file writes escaped is left escaped, the other kinds are repaired", () => {
    // The file writes `\n` escaped (real text) but never `\"`: only the quotes are repaired.
    const r = applyStringEdit('a = "x\\n";\nb = "q";\n', 'a = \\"x\\n\\";', 'a = \\"y\\n\\";');
    expect(r.matchedBy).toBe("unescaped");
    expect(r.content).toBe('a = "y\\n";\nb = "q";\n');
  });

  it("whitespace: refuses a Python match whose nesting differs from oldString's", () => {
    const file = "def f():\n    if x:\n        a()\n    b()\n";
    const r = applyStringEdit(file, "if x:\na()\nb()", "if x:\nc()\nb()");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
  });

  it("whitespace: refuses a YAML match whose indent order is inverted", () => {
    const file = "a:\n  b: 1\nc: 2\n";
    const r = applyStringEdit(file, "  a:\nb: 1\n  c: 2", "  a:\nb: 9\n  c: 2");
    expect(r.ok).toBe(false);
  });

  it("whitespace: a partial edge never lands mid-token", () => {
    expect(applyStringEdit("  const value = compute(1);\n  next();\n", "lue = compute(1);\n    next();", "x").ok).toBe(false);
    expect(applyStringEdit("  foo();\n  barbaz();\n", "    foo();\n  bar", "x").ok).toBe(false);
  });

  it("whitespace: two partial edges with no whole line between them are no match", () => {
    expect(applyStringEdit("  const x = 1;\n  yield z;\n", "x = 1;\n    yield", "x").ok).toBe(false);
  });

  it("whitespace: mixed tab+space file indent maps, and a line shallower than any mapped indent is left as written", () => {
    const r = applyStringEdit("{\n\t    x();\n}\n", "        x();", "        y();\n    z();");
    expect(r.matchedBy).toBe("whitespace");
    expect(r.content).toBe("{\n\t    y();\n    z();\n}\n");
  });

  it("whitespace: ignores trailing whitespace on file lines", () => {
    const r = applyStringEdit("function f() {  \n  return 1;\n}\n", "function f() {\n  return 1;", "function f() {\n  return 2;");
    expect(r.ok).toBe(true);
    expect(r.matchedBy).toBe("whitespace");
    expect(r.content).toBe("function f() {\n  return 2;\n}\n");
  });

  it("whitespace: matches spaces against tabs and writes newString in the file's tabs", () => {
    const file = "class A {\n\tgo() {\n\t\treturn 1;\n\t}\n}\n";
    const r = applyStringEdit(file, "    go() {\n        return 1;\n    }", "    go() {\n        return 2;\n    }");
    expect(r.ok).toBe(true);
    expect(r.matchedBy).toBe("whitespace");
    expect(r.content).toBe("class A {\n\tgo() {\n\t\treturn 2;\n\t}\n}\n");
  });

  it("whitespace: re-indents newString by the file's indentation delta", () => {
    const r = applyStringEdit("  if (x) {\n    y();\n  }\n", "if (x) {\n  y();\n}", "if (x) {\n  z();\n  w();\n}");
    expect(r.content).toBe("  if (x) {\n    z();\n    w();\n  }\n");
    expect(r.region).toEqual({ startLine: 1, endLine: 4 });
  });

  it("whitespace: a partial first line matches by trimmed content and keeps the line's prefix", () => {
    const r = applyStringEdit("  const v = compute(1);\n  next();\n", "v = compute(1);\n    next();", "v = compute(2);\n    next();");
    expect(r.matchedBy).toBe("whitespace");
    expect(r.content).toBe("  const v = compute(2);\n  next();\n");
  });

  it("whitespace: an oldString trailing newline matches a last line with none, and adds none", () => {
    const r = applyStringEdit("x();\n\ty();", "x();\n  y();\n", "x();\n  z();\n");
    expect(r.ok).toBe(true);
    expect(r.content).toBe("x();\n\tz();");
  });

  it("whitespace: refuses an ambiguous fuzzy match, replaces every one under replaceAll", () => {
    const file = "\tfoo();\n\tfoo();\n";
    const amb = applyStringEdit(file, "  foo();", "  bar();");
    expect(amb.ok).toBe(false);
    expect(amb.error).toMatch(/not unique/);
    const all = applyStringEdit(file, "  foo();", "  bar();", true);
    expect(all.replaced).toBe(2);
    expect(all.content).toBe("\tbar();\n\tbar();\n");
  });

  it("whitespace: a CRLF file stays pure CRLF", () => {
    const r = applyStringEdit("a {\r\n\tb();\r\n}\r\n", "a {\n    b();\n}", "a {\n    c();\n    d();\n}");
    expect(r.ok).toBe(true);
    expect(r.content).toBe("a {\r\n\tc();\r\n\td();\r\n}\r\n");
  });

  it("editFacts carries matchedBy only for a tolerant tier", () => {
    expect(editFacts(applyStringEdit("\tfoo();\n", "  foo();", "  bar();")).matchedBy).toBe("whitespace");
    expect(editFacts(applyStringEdit(LF, "const b = 2;", "x"))).not.toHaveProperty("matchedBy");
  });

  it("a batch edit lands through a tolerant tier", async () => {
    const files = new Map<string, string>([["a.ts", "\tfoo();\n"], ["b.ts", 'say("hi");\n']]);
    const io = { read: async (p: string) => files.get(p) ?? null, write: async (p: string, c: string) => void files.set(p, c) };
    const r = await applyBatchEdits(planBatchEdits([
      { path: "a.ts", old_string: "  foo();", new_string: "  bar();" },
      { path: "b.ts", old_string: 'say(\\"hi\\");', new_string: 'say(\\"bye\\");' },
    ]), io);
    expect(r.ok).toBe(true);
    expect(r.files.map((f) => f.matchedBy)).toEqual(["whitespace", "unescaped"]);
    expect(files.get("a.ts")).toBe("\tbar();\n");
    expect(files.get("b.ts")).toBe('say("bye");\n');
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
