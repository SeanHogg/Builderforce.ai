import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rewindLastTurn } from "./sessions-undo.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "builderforce-sessions-undo-"));
  dirs.push(dir);
  return dir;
}

function writeTranscript(
  file: string,
  messages: Array<{ id: string; parentId: string | null; role: string; content: string }>,
) {
  const header = {
    type: "session",
    version: 3,
    id: "sess-undo",
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  };
  const lines = [
    JSON.stringify(header),
    ...messages.map((m) =>
      JSON.stringify({
        type: "message",
        id: m.id,
        parentId: m.parentId,
        timestamp: new Date().toISOString(),
        message: { role: m.role, content: m.content },
      }),
    ),
  ];
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

function messageContents(file: string): string[] {
  return fs
    .readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { type?: string; message?: { content?: string } })
    .filter((parsed) => parsed.type === "message")
    .map((parsed) => String(parsed.message?.content ?? ""));
}

describe("rewindLastTurn", () => {
  it("drops the last user+assistant turn and keeps the prior turn", () => {
    const dir = makeDir();
    const file = path.join(dir, "sess-undo.jsonl");
    writeTranscript(file, [
      { id: "u1", parentId: null, role: "user", content: "first" },
      { id: "a1", parentId: "u1", role: "assistant", content: "first-reply" },
      { id: "u2", parentId: "a1", role: "user", content: "second" },
      { id: "a2", parentId: "u2", role: "assistant", content: "second-reply" },
    ]);

    const result = rewindLastTurn(file);
    expect(result.undone).toBe(true);
    expect(result.leafId).toBe("a1");
    expect(messageContents(file)).toEqual(["first", "first-reply"]);
  });

  it("drops associated tool results with the last user turn", () => {
    const dir = makeDir();
    const file = path.join(dir, "sess-undo.jsonl");
    writeTranscript(file, [
      { id: "u1", parentId: null, role: "user", content: "keep" },
      { id: "a1", parentId: "u1", role: "assistant", content: "keep-reply" },
      { id: "u2", parentId: "a1", role: "user", content: "drop" },
      { id: "a2", parentId: "u2", role: "assistant", content: "drop-reply" },
      { id: "t1", parentId: "a2", role: "tool", content: "tool-result" },
    ]);

    const result = rewindLastTurn(file);
    expect(result.undone).toBe(true);
    expect(messageContents(file)).toEqual(["keep", "keep-reply"]);
  });

  it("rewinds consecutive turns, then no-ops at the root", () => {
    const dir = makeDir();
    const file = path.join(dir, "sess-undo.jsonl");
    writeTranscript(file, [
      { id: "u1", parentId: null, role: "user", content: "first" },
      { id: "a1", parentId: "u1", role: "assistant", content: "first-reply" },
      { id: "u2", parentId: "a1", role: "user", content: "second" },
      { id: "a2", parentId: "u2", role: "assistant", content: "second-reply" },
    ]);

    expect(rewindLastTurn(file)).toMatchObject({ undone: true, leafId: "a1" });
    expect(messageContents(file)).toEqual(["first", "first-reply"]);

    const second = rewindLastTurn(file);
    expect(second.undone).toBe(true);
    expect(second.leafId).toBeNull();
    expect(messageContents(file)).toEqual([]);

    const raw = fs.readFileSync(file, "utf-8");
    const third = rewindLastTurn(file);
    expect(third.undone).toBe(false);
    expect(fs.readFileSync(file, "utf-8")).toBe(raw);
  });

  it("returns undone:false when the transcript is missing", () => {
    const dir = makeDir();
    const file = path.join(dir, "missing.jsonl");
    expect(rewindLastTurn(file)).toEqual({ undone: false, leafId: null });
    expect(fs.existsSync(file)).toBe(false);
  });
});
