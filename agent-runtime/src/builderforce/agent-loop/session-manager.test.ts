import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AssistantMessage, UserMessage } from "../model/types.js";
import { buildSessionContext, loadEntriesFromFile, SessionManager } from "./session-manager.js";

const userMsg = (text: string): UserMessage => ({ role: "user", content: text, timestamp: 0 });
const assistantMsg = (text: string): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "openai-completions",
  provider: "openai",
  model: "gpt-test",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 0,
});

describe("native SessionManager", () => {
  it("persists a header + entries as JSONL and reloads them (round-trip, byte-compatible)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sm-"));
    const file = join(dir, "s.jsonl");
    const sm = SessionManager.open(file);
    sm.appendMessage(userMsg("hello"));
    sm.appendMessage(assistantMsg("hi there")); // assistant flush triggers write
    expect(sm.getEntries()).toHaveLength(2);

    const entries = loadEntriesFromFile(file);
    expect(entries[0]).toMatchObject({ type: "session", version: 3 });
    expect(entries).toHaveLength(3); // header + 2 messages
    expect((entries[1] as { message: UserMessage }).message.content).toBe("hello");

    // reload into a fresh manager
    const sm2 = SessionManager.open(file);
    const ctx = sm2.buildSessionContext();
    expect(ctx.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(ctx.model).toEqual({ provider: "openai", modelId: "gpt-test" });
  });

  it("maintains a leaf->root tree; appendMessage advances the leaf", () => {
    const sm = SessionManager.inMemory();
    const id1 = sm.appendMessage(userMsg("a"));
    const id2 = sm.appendMessage(assistantMsg("b"));
    expect(sm.getLeafId()).toBe(id2);
    expect(sm.getEntry(id2)?.parentId).toBe(id1);
    expect(sm.getBranch().map((e) => e.id)).toEqual([id1, id2]);
  });

  it("buildSessionContext cuts to firstKeptEntryId and prepends the compaction summary", () => {
    const sm = SessionManager.inMemory();
    sm.appendMessage(userMsg("old-1"));
    sm.appendMessage(assistantMsg("old-2"));
    const keepId = sm.appendMessage(userMsg("kept"));
    sm.appendCompaction("SUMMARY", keepId, 123);
    sm.appendMessage(assistantMsg("after"));

    const ctx = sm.buildSessionContext();
    expect(ctx.messages[0].role).toBe("compactionSummary");
    // dropped old-1/old-2; kept "kept" + "after"
    const texts = ctx.messages.map((m) =>
      m.role === "user"
        ? (m.content as string)
        : m.role === "assistant"
          ? (m.content[0] as { text: string }).text
          : m.role,
    );
    expect(texts).toEqual(["compactionSummary", "kept", "after"]);
  });

  it("migrates a v1 session file (index-based, no ids) to v3 on open", () => {
    const dir = mkdtempSync(join(tmpdir(), "sm-v1-"));
    const file = join(dir, "v1.jsonl");
    // v1 format: header with no version, entries with no id/parentId
    const lines = [
      JSON.stringify({
        type: "session",
        id: "sess1",
        timestamp: "2020-01-01T00:00:00.000Z",
        cwd: "/x",
      }),
      JSON.stringify({ type: "message", message: userMsg("hi") }),
      JSON.stringify({ type: "message", message: assistantMsg("yo") }),
    ];
    writeFileSync(file, `${lines.join("\n")}\n`);

    const sm = SessionManager.open(file);
    const header = sm.getHeader();
    expect(header?.version).toBe(3);
    const entries = sm.getEntries();
    expect(entries.every((e) => typeof e.id === "string" && e.id.length > 0)).toBe(true);
    // v1→v2 wired parentId chain
    expect(entries[1].parentId).toBe(entries[0].id);
    // file rewritten with migrated content
    expect(readFileSync(file, "utf8")).toContain('"version":3');
  });

  it("standalone buildSessionContext returns empty for leafId === null", () => {
    expect(buildSessionContext([], null).messages).toEqual([]);
  });
});
