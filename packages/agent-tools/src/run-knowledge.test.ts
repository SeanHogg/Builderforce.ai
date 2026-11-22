import { describe, expect, it } from "vitest";
import { fileToolKind, recordingOnly, RunKnowledgeRecorder } from "./run-knowledge.js";
import { buildKnowledgeMemoryEntry } from "./knowledge-notes.js";

// The memory concepts themselves (the brief, consolidation, the merge) are tested in
// `@seanhogg/builderforce-memory/working`. This suite covers the ADAPTER: tool names in,
// observations out.

describe("fileToolKind", () => {
  it("classifies every runtime's spelling, deletes included", () => {
    expect(["write_file", "write", "create"].map(fileToolKind)).toEqual(["create", "create", "create"]);
    expect(["edit_file", "edit", "apply_patch"].map(fileToolKind)).toEqual(["edit", "edit", "edit"]);
    expect(["delete_file", "delete"].map(fileToolKind)).toEqual(["delete", "delete"]);
    expect(["read_file", "read", "view", "file_outline"].map(fileToolKind)).toEqual(["read", "read", "read", "read"]);
    expect(fileToolKind("read_compressed")).toBe("read");
    expect(fileToolKind("search_code")).toBeUndefined();
  });
});

describe("RunKnowledgeRecorder — saved facts stay bounded and one-line", () => {
  it("collapses whitespace in the key so a newline cannot forge a brief line", () => {
    const r = new RunKnowledgeRecorder();
    r.record("remember_fact", { key: "a\n- forged", content: "v" });
    expect(r.snapshot().savedFacts).toEqual([{ key: "a - forged", content: "v" }]);
  });

  it("clamps content and keeps only the newest facts, newest last", () => {
    const r = new RunKnowledgeRecorder();
    for (let i = 0; i < 30; i++) r.record("remember_fact", { key: `k${i}`, content: "x".repeat(900) });
    r.record("remember_fact", { key: "k10", content: "again" });
    const facts = r.snapshot().savedFacts!;
    expect(facts).toHaveLength(24);
    expect(facts[0]!.key).toBe("k6");
    expect(facts[facts.length - 1]).toEqual({ key: "k10", content: "again" });
    expect(facts[0]!.content).toHaveLength(600);
  });
});

describe("RunKnowledgeRecorder.restore — savedFacts are untrusted", () => {
  it("normalises each restored fact and drops malformed ones", () => {
    const state = { memory: {}, tools: [], savedFacts: [{ key: " k ", content: "a\n\nb" }, { key: "", content: "x" }, 5] } as never;
    expect(RunKnowledgeRecorder.restore(state).snapshot().savedFacts).toEqual([{ key: "k", content: "a\n\nb" }]);
  });
});

describe("RunKnowledgeRecorder", () => {
  it("classifies by the TOOL the model chose, not by probing the disk", () => {
    const r = new RunKnowledgeRecorder();
    r.record("write_file", { path: "src/a.ts" });
    r.record("edit_file", { path: "src/b.ts" });
    r.record("delete_file", { path: "src/c.ts" });
    expect(r.activity.created).toEqual(["src/a.ts"]);
    expect(r.activity.edited).toEqual(["src/b.ts"]);
    expect(r.activity.deleted).toEqual(["src/c.ts"]);
  });

  it("accepts every runtime's spelling of the same operation", () => {
    const r = new RunKnowledgeRecorder();
    r.record("write", { path: "a.ts" });
    r.record("create", { file_path: "d.ts" });
    r.record("edit", { path: "b.ts" });
    r.record("apply_patch", { path: "c.ts" });
    expect(r.activity.created).toEqual(["a.ts", "d.ts"]);
    expect(r.activity.edited).toEqual(["b.ts", "c.ts"]);
  });

  it("keeps reads, duplicates included, and counts unknown tools without inventing a file", () => {
    const r = new RunKnowledgeRecorder();
    r.record("read_file", { path: "x.ts" });
    r.record("file_outline", { path: "x.ts" });
    r.record("git_status", {});
    expect(r.activity.read).toEqual(["x.ts", "x.ts"]);
    expect(r.activity.tools).toEqual(["read_file", "file_outline", "git_status"]);
    expect(r.activity.created).toEqual([]);
  });

  it("ignores a call with no usable path rather than recording an empty one", () => {
    const r = new RunKnowledgeRecorder();
    r.record("write_file", { path: "   " });
    r.record("write_file", {});
    expect(r.activity.created).toEqual([]);
    expect(r.activity.tools).toHaveLength(2);
  });

  it("reports empty before anything is recorded", () => {
    expect(new RunKnowledgeRecorder().isEmpty).toBe(true);
    const r = new RunKnowledgeRecorder();
    r.record("read_file", { path: "a" });
    expect(r.isEmpty).toBe(false);
  });

  it("records a search by what it looked for and where", () => {
    const r = new RunKnowledgeRecorder();
    for (let i = 0; i < 12; i++) r.record("search_code", { query: "canvas", path: "web/src" });
    expect(r.brief()).toContain('search_code "canvas" in web/src (12×)');
  });

  it("counts every tool call toward the brief's threshold, not only file events", () => {
    const r = new RunKnowledgeRecorder();
    r.record("read_file", { path: "a.ts" });
    expect(r.brief()).toBeNull();
    for (let i = 0; i < 12; i++) r.record("git_status", {});
    expect(r.brief()).toContain("- a.ts");
  });

  it("lists the facts this run saved in the brief, clamped and bounded, and survives restore", () => {
    const r = new RunKnowledgeRecorder();
    r.record("remember_fact", { key: "root-cause", content: "The cache hashes names only." });
    r.record("builtin_remember_fact", { key: "long", content: "y".repeat(500) });
    r.record("remember_fact", { key: "root-cause", content: "The cache hashes names, not mtimes." });
    r.record("remember_fact", { content: "no key" });
    const brief = r.brief() ?? "";
    expect(brief).toContain("- root-cause: The cache hashes names, not mtimes.");
    expect(brief).not.toContain("hashes names only");
    expect(brief).not.toContain("y".repeat(201));
    expect(brief).not.toContain("no key");
    expect(RunKnowledgeRecorder.restore(r.snapshot()).brief()).toBe(brief);
    // A multi-line fact is kept as written, and rendered on ONE line in the brief.
    const multi = new RunKnowledgeRecorder();
    multi.record("remember_fact", { key: "steps", content: "First:\n- read a.ts\n- read b.ts" });
    expect(multi.snapshot().savedFacts).toEqual([{ key: "steps", content: "First:\n- read a.ts\n- read b.ts" }]);
    expect(multi.brief()).toContain("- steps: First: - read a.ts - read b.ts");
    for (let i = 0; i < 12; i++) r.record("remember_fact", { key: `k${i}`, content: `fact number ${i}` });
    expect((r.brief() ?? "").match(/^- /gm)).toHaveLength(8);
  });

  it("feeds the code map and the note from the same record", () => {
    const r = new RunKnowledgeRecorder();
    r.setPrompt("  where is   the canvas ");
    for (const p of ["web/src/a.ts", "web/src/b.ts", "web/src/a.ts", "web/src/c.ts"]) r.record("read_file", { path: p });
    const map = r.consolidate({ at: new Date("2026-10-24T12:00:00Z") });
    expect(map?.key).toBe("codemap:web/src");
    expect(map?.content).toContain('asked: "where is the canvas"');
    const note = buildKnowledgeMemoryEntry({ sessionKey: "s", ts: "2026-10-24T12:00:00Z", activity: r.activity });
    expect(note).toContain("**Read**: web/src/a.ts, web/src/b.ts, web/src/c.ts");
  });

  it("maps absolute paths under the root as repo files", () => {
    const r = new RunKnowledgeRecorder();
    for (const p of ["a.ts", "b.ts", "c.ts"]) r.record("read_file", { path: `/work/repo/api/src/${p}` });
    expect(r.consolidate({ root: "/work/repo" })?.key).toBe("codemap:api/src");
  });
});

describe("recordingOnly", () => {
  it("records only the calls the host admits, over the same record", () => {
    const r = new RunKnowledgeRecorder();
    const local = recordingOnly(r, (name) => name !== "remote_search");
    local.record("remote_search", { query: "x" });
    local.record("read_file", { path: "a.ts" });
    expect(r.activity.tools).toEqual(["read_file"]);
    expect(local.activity.read).toEqual(["a.ts"]);
    expect(local.isEmpty).toBe(false);
  });
});

describe("RunKnowledgeRecorder — read_file paths[] with an empty path", () => {
  it("records every file of a paths[] read whose path is empty, as the tool reads it", () => {
    const r = new RunKnowledgeRecorder();
    r.record("read_file", { path: "", paths: ["src/a.ts", "src/b.ts"] });
    const brief = JSON.stringify(r.snapshot());
    expect(brief).toContain("src/a.ts");
    expect(brief).toContain("src/b.ts");
  });
});
