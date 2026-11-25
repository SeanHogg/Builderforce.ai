import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RunKnowledgeRecorder } from "@builderforce/agent-tools";
import { appendSessionNote, readRecentSessionNotes } from "./sessionNotes";

async function workspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "bf-notes-"));
}

const memoryDir = (root: string) => path.join(root, ".builderforce", "memory");

describe("appendSessionNote", () => {
  it("summarises the ask instead of a fixed label when the run recorded one", async () => {
    const root = await workspace();
    const notes = new RunKnowledgeRecorder();
    notes.setPrompt("fix the map cache so an edit refreshes it");
    notes.record("edit_file", { path: "src/a.ts" });
    const wrote = await appendSessionNote(root, {
      sessionKey: "chat-7",
      activity: notes.activity,
      at: new Date("2026-08-20T10:00:00.000Z"),
    });
    expect(wrote).toBe(true);
    const text = await fs.readFile(path.join(memoryDir(root), "2026-08-20.md"), "utf-8");
    expect(text).toContain("**Summary**: fix the map cache so an edit refreshes it");
    expect(text).not.toContain("Code review / analysis");
  });

  it("writes into the SAME tree and filename the on-prem loop uses", async () => {
    const root = await workspace();
    const at = new Date("2026-08-20T10:00:00.000Z");
    const wrote = await appendSessionNote(root, {
      sessionKey: "chat-7",
      activity: { created: ["src/a.ts"], tools: ["write_file"] },
      at,
    });
    expect(wrote).toBe(true);
    const file = path.join(memoryDir(root), "2026-08-20.md");
    const text = await fs.readFile(file, "utf-8");
    expect(text).toContain("## [2026-08-20T10:00:00.000Z] session:chat-7");
    expect(text).toContain("**Created**: src/a.ts");
    expect(text).toContain("**Summary**:");
  });

  it("APPENDS — a second run in the same day joins the first", async () => {
    const root = await workspace();
    const at = new Date("2026-08-20T10:00:00.000Z");
    await appendSessionNote(root, { sessionKey: "a", activity: { tools: ["read_file"] }, at });
    await appendSessionNote(root, { sessionKey: "b", activity: { tools: ["read_file"] }, at });
    const text = await fs.readFile(path.join(memoryDir(root), "2026-08-20.md"), "utf-8");
    expect(text).toContain("session:a");
    expect(text).toContain("session:b");
  });

  it("writes NOTHING for a run that did nothing", async () => {
    // An empty heading costs the next grounding pass tokens and tells it nothing.
    const root = await workspace();
    expect(await appendSessionNote(root, { sessionKey: "x", activity: {} })).toBe(false);
    await expect(fs.readdir(memoryDir(root))).rejects.toThrow();
  });

  it("reports failure instead of throwing when the tree cannot be written", async () => {
    // A read-only workspace must cost a note, never a turn.
    const root = await workspace();
    // A FILE where the `.builderforce` directory needs to be: mkdir must fail.
    await fs.writeFile(path.join(root, ".builderforce"), "not a directory", "utf-8");
    const wrote = await appendSessionNote(root, {
      sessionKey: "x",
      activity: { tools: ["read_file"] },
    });
    expect(wrote).toBe(false);
  });
});

describe("readRecentSessionNotes", () => {
  it("returns nothing when there is no memory tree at all", async () => {
    expect(await readRecentSessionNotes(await workspace())).toBe("");
  });

  it("reads the newest days first and bounds how many", async () => {
    const root = await workspace();
    await fs.mkdir(memoryDir(root), { recursive: true });
    for (const day of ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"]) {
      await fs.writeFile(path.join(memoryDir(root), `${day}.md`), `note for ${day}`, "utf-8");
    }
    const out = await readRecentSessionNotes(root, { maxDays: 2 });
    expect(out).toContain("2026-08-20");
    expect(out).toContain("2026-08-19");
    expect(out).not.toContain("2026-08-18");
    expect(out.indexOf("2026-08-20")).toBeLessThan(out.indexOf("2026-08-19"));
  });

  it("ignores files that are not dated notes", async () => {
    const root = await workspace();
    await fs.mkdir(memoryDir(root), { recursive: true });
    await fs.writeFile(path.join(memoryDir(root), ".gitkeep"), "", "utf-8");
    await fs.writeFile(path.join(memoryDir(root), "team-memory.json"), "{}", "utf-8");
    await fs.writeFile(path.join(memoryDir(root), "2026-08-20.md"), "real note", "utf-8");
    const out = await readRecentSessionNotes(root);
    // The note body survives; the block is wrapped in the cross-session guardrail.
    expect(out).toContain("real note");
    expect(out).toContain("OTHER sessions");
    expect(out).not.toContain("team-memory");
  });

  it("keeps the TAIL when a day exceeds the budget — newest entries are appended last", async () => {
    const root = await workspace();
    await fs.mkdir(memoryDir(root), { recursive: true });
    await fs.writeFile(path.join(memoryDir(root), "2026-08-20.md"), `${"x".repeat(500)}NEWEST`, "utf-8");
    const out = await readRecentSessionNotes(root, { maxChars: 50 });
    expect(out).toContain("NEWEST");
    expect(out.length).toBeLessThan(400);
  });

  it("redacts foreign session identifiers and drops steerable summaries", async () => {
    const root = await workspace();
    await fs.mkdir(memoryDir(root), { recursive: true });
    await appendSessionNote(root, {
      sessionKey: "chat-22844",
      activity: { edited: ["Builderforce.ai/docs/specs/38-prd-knowledge-graph.md"], tools: ["read_file"] },
      at: new Date("2026-08-20T10:00:00.000Z"),
    });
    const out = await readRecentSessionNotes(root);
    // Another session's note must not hand this chat an actionable agenda.
    expect(out).not.toContain("session:chat-22844");
    expect(out).not.toContain("**Summary**");
    // The block is labelled as other sessions' reference work.
    expect(out).toContain("OTHER sessions");
    expect(out).toContain("Never resume");
    // The workspace-shape half of the loop (what was touched) still grounds.
    expect(out).toContain("38-prd-knowledge-graph.md");
  });

  it("keeps the current chat's own session key identifiable", async () => {
    const root = await workspace();
    await fs.mkdir(memoryDir(root), { recursive: true });
    await appendSessionNote(root, {
      sessionKey: "chat-16805",
      activity: { edited: ["src/a.ts"], tools: ["edit_file"] },
      at: new Date("2026-08-20T10:00:00.000Z"),
    });
    await appendSessionNote(root, {
      sessionKey: "chat-99999",
      activity: { edited: ["src/b.ts"], tools: ["edit_file"] },
      at: new Date("2026-08-20T11:00:00.000Z"),
    });
    const out = await readRecentSessionNotes(root, { currentSessionKey: "chat-16805" });
    expect(out).toContain("session:chat-16805 (this chat)");
    expect(out).not.toContain("session:chat-99999");
  });
});
