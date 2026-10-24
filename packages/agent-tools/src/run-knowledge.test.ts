import { describe, expect, it } from "vitest";
import { buildCodeMapFact, CODE_MAP_FACT_PREFIX, codeMapFactKey, codeMapFromActivity, RunKnowledgeRecorder } from "./run-knowledge.js";
import { buildKnowledgeMemoryEntry } from "./knowledge-notes.js";

const AT = new Date("2026-10-24T12:00:00Z");

describe("buildCodeMapFact", () => {
  it("keys the map by the directory the top files share and ranks changed, then most-read", () => {
    const fact = buildCodeMapFact(
      {
        prompt: "Move the visualization canvas to a side panel",
        read: [
          "clients/vscode/webview/src/WorkspaceApp.tsx",
          "clients/vscode/webview/src/WorkspaceApp.tsx",
          "clients/vscode/webview/src/visualization/VisualizationPanel.tsx",
          "clients/vscode/webview/src/WorkspaceApp.tsx",
        ],
        changed: ["clients/vscode/webview/src/chat/VsCodeChatSurface.tsx"],
      },
      AT,
    );
    expect(fact?.key).toBe(`${CODE_MAP_FACT_PREFIX}clients/vscode/webview/src`);
    const lines = fact!.content.split("\n");
    expect(lines[0]).toContain("2026-10-24");
    expect(lines[0]).toContain("Move the visualization canvas");
    expect(lines.slice(2)).toEqual([
      "- clients/vscode/webview/src/chat/VsCodeChatSurface.tsx (changed)",
      "- clients/vscode/webview/src/WorkspaceApp.tsx (read 3×)",
      "- clients/vscode/webview/src/visualization/VisualizationPanel.tsx",
    ]);
  });

  it("skips a short lookup that changed nothing", () => {
    expect(buildCodeMapFact({ read: ["a/b/c.ts", "a/b/d.ts"], changed: [] }, AT)).toBeNull();
    expect(buildCodeMapFact({ read: [], changed: [] }, AT)).toBeNull();
  });

  it("keeps a single changed file — an edit is always worth mapping", () => {
    expect(buildCodeMapFact({ read: [], changed: ["api/src/routes/x.ts"] }, AT)?.key).toBe("codemap:api/src/routes");
  });

  it("falls back to the most-used file's folder when the files share too little", () => {
    const fact = buildCodeMapFact(
      { read: ["api/src/a/x.ts", "api/src/a/x.ts", "frontend/src/y.tsx", "docs/z.md"], changed: [] },
      AT,
    );
    expect(fact?.key).toBe("codemap:api/src/a");
  });

  it("normalises separators and drops paths outside the repo", () => {
    const fact = buildCodeMapFact(
      { read: [".\\pkg\\src\\a.ts", "pkg/src/b.ts", "../secret.ts", "C:/abs/c.ts", "/etc/passwd", "pkg/src/c.ts"], changed: [] },
      AT,
    );
    expect(fact?.content).not.toMatch(/secret|abs|passwd/);
    expect(fact?.content).toContain("- pkg/src/a.ts");
    expect(fact?.key).toBe("codemap:pkg/src");
  });

  it("bounds the key", () => {
    expect(codeMapFactKey("x".repeat(400)).length).toBe(255);
  });
});

describe("RunKnowledgeRecorder", () => {
  it("classifies by the TOOL the model chose, not by probing the disk", () => {
    const r = new RunKnowledgeRecorder();
    r.record("write_file", { path: "src/a.ts" });
    r.record("edit_file", { path: "src/b.ts" });
    expect(r.activity.created).toEqual(["src/a.ts"]);
    expect(r.activity.edited).toEqual(["src/b.ts"]);
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
    r.record("search_code", { query: "x" });
    expect(r.activity.read).toEqual(["x.ts", "x.ts"]);
    expect(r.activity.tools).toEqual(["read_file", "file_outline", "search_code"]);
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

  it("feeds the code map and the note from the same record", () => {
    const r = new RunKnowledgeRecorder();
    r.setPrompt("  where is   the canvas ");
    for (const p of ["web/src/a.ts", "web/src/b.ts", "web/src/a.ts", "web/src/c.ts"]) r.record("read_file", { path: p });
    const fact = codeMapFromActivity(r.activity, AT);
    expect(fact?.key).toBe("codemap:web/src");
    expect(fact?.content).toContain('asked: "where is the canvas"');
    const note = buildKnowledgeMemoryEntry({ sessionKey: "s", ts: AT.toISOString(), activity: r.activity });
    expect(note).toContain("**Read**: web/src/a.ts, web/src/b.ts, web/src/c.ts");
  });
});
