import { describe, it, expect } from "vitest";
import { applyStringEdit } from "@builderforce/agent-tools";

describe("applyStringEdit — EOL-tolerant, EOL-preserving edit_file core", () => {
  it("matches an LF oldString against a CRLF file and PRESERVES the file's CRLF", () => {
    const file = "line one\r\nif (x) return false;\r\nline three\r\n";
    // Agent emits LF (the failure mode: repeated "oldString not found" on Windows).
    const res = applyStringEdit(file, "if (x) return false;\n", "if (x) return true;\n");
    expect(res.ok).toBe(true);
    expect(res.content).toBe("line one\r\nif (x) return true;\r\nline three\r\n");
    // Untouched lines keep their CRLF — no whole-file normalization.
    expect(res.content!.split("\r\n").length).toBe(4);
  });

  it("matches a CRLF oldString against an LF file", () => {
    const file = "a\nb\nc\n";
    const res = applyStringEdit(file, "a\r\nb\r\n", "A\r\nB\r\n");
    expect(res.ok).toBe(true);
    expect(res.content).toBe("A\nB\nc\n");
  });

  it("still does a plain literal replace when endings already agree", () => {
    const res = applyStringEdit("const x = 1;\n", "const x = 1;", "const x = 2;");
    expect(res.ok).toBe(true);
    expect(res.content).toBe("const x = 2;\n");
    expect(res.replaced).toBe(1);
  });

  it("rejects a non-unique oldString unless replaceAll", () => {
    const file = "dup\r\ndup\r\n";
    expect(applyStringEdit(file, "dup\n", "x\n").ok).toBe(false);
    const all = applyStringEdit(file, "dup\n", "x\n", true);
    expect(all.ok).toBe(true);
    expect(all.replaced).toBe(2);
    expect(all.content).toBe("x\r\nx\r\n");
  });

  it("returns a helpful error when the text genuinely is not present", () => {
    const res = applyStringEdit("hello\r\n", "goodbye\n", "x");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it("rejects an empty oldString", () => {
    expect(applyStringEdit("x", "", "y").ok).toBe(false);
  });
});
