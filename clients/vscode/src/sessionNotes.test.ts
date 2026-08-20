import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { appendSessionNote, readRecentSessionNotes, SessionNotes } from "./sessionNotes";

async function workspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "bf-notes-"));
}

const memoryDir = (root: string) => path.join(root, ".builderforce", "memory");

describe("SessionNotes accumulator", () => {
  it("classifies by the TOOL the model chose, not by probing the disk", () => {
    // By the time a run ends, a created file and an edited file both exist, so a
    // stat-based guess would call every write an edit.
    const notes = new SessionNotes();
    notes.record("write_file", { path: "src/a.ts" });
    notes.record("edit_file", { path: "src/b.ts" });
    expect(notes.activity.created).toEqual(["src/a.ts"]);
    expect(notes.activity.edited).toEqual(["src/b.ts"]);
  });

  it("accepts both the shared and native tool names for the same operation", () => {
    // On-prem exposes the shared `write_file`/`edit_file` under the native names
    // `write`/`edit`; the notes must not miss half the run because of the alias.
    const notes = new SessionNotes();
    notes.record("write", { path: "a.ts" });
    notes.record("edit", { path: "b.ts" });
    notes.record("apply_patch", { path: "c.ts" });
    expect(notes.activity.created).toEqual(["a.ts"]);
    expect(notes.activity.edited).toEqual(["b.ts", "c.ts"]);
  });

  it("counts an unknown tool toward Tools without inventing a file", () => {
    const notes = new SessionNotes();
    notes.record("search_code", { query: "x" });
    expect(notes.activity.tools).toEqual(["search_code"]);
    expect(notes.activity.created).toEqual([]);
    expect(notes.activity.edited).toEqual([]);
  });

  it("ignores a call with no usable path rather than recording an empty one", () => {
    const notes = new SessionNotes();
    notes.record("write_file", { path: "   " });
    notes.record("write_file", {});
    expect(notes.activity.created).toEqual([]);
    expect(notes.activity.tools).toHaveLength(2);
  });

  it("reports empty before anything is recorded", () => {
    expect(new SessionNotes().isEmpty).toBe(true);
    const notes = new SessionNotes();
    notes.record("read_file", { path: "a" });
    expect(notes.isEmpty).toBe(false);
  });
});

describe("appendSessionNote", () => {
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
    expect(await readRecentSessionNotes(root)).toBe("real note");
  });

  it("keeps the TAIL when a day exceeds the budget — newest entries are appended last", async () => {
    const root = await workspace();
    await fs.mkdir(memoryDir(root), { recursive: true });
    await fs.writeFile(path.join(memoryDir(root), "2026-08-20.md"), `${"x".repeat(500)}NEWEST`, "utf-8");
    const out = await readRecentSessionNotes(root, { maxChars: 50 });
    expect(out).toContain("NEWEST");
    expect(out.length).toBeLessThan(120);
  });
});
