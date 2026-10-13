import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cloneSessionTranscript } from "./sessions-fork.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "builderforce-sessions-fork-"));
  dirs.push(dir);
  return dir;
}

describe("cloneSessionTranscript", () => {
  it("clones a v3 transcript onto a new file with parentSession and leaves the parent unchanged", () => {
    const dir = makeDir();
    const parentFile = path.join(dir, "parent.jsonl");
    const header = {
      type: "session",
      version: 3,
      id: "parent-session",
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    const message = {
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "Parent prompt" },
    };
    const parentRaw = `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`;
    fs.writeFileSync(parentFile, parentRaw);

    const cloned = cloneSessionTranscript({ parentFile, sessionDir: dir });

    expect(cloned.sessionFile).not.toBe(path.resolve(parentFile));
    expect(cloned.sessionId).not.toBe("parent-session");
    expect(fs.readFileSync(parentFile, "utf-8")).toBe(parentRaw);

    const lines = fs
      .readFileSync(cloned.sessionFile, "utf-8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    const clonedHeader = JSON.parse(lines[0] ?? "{}") as {
      type?: string;
      id?: string;
      parentSession?: string;
    };
    expect(clonedHeader.type).toBe("session");
    expect(clonedHeader.id).toBe(cloned.sessionId);
    expect(clonedHeader.parentSession).toBe(path.resolve(parentFile));
    expect(lines.some((line) => line.includes("Parent prompt"))).toBe(true);
  });

  it("writes a header-only fork when the parent has no leaf messages", () => {
    const dir = makeDir();
    const parentFile = path.join(dir, "empty.jsonl");
    fs.writeFileSync(
      parentFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "empty-session",
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      })}\n`,
    );

    const cloned = cloneSessionTranscript({ parentFile, sessionDir: dir });
    expect(cloned.sessionId).not.toBe("empty-session");
    const [headerLine] = fs
      .readFileSync(cloned.sessionFile, "utf-8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    const clonedHeader = JSON.parse(headerLine ?? "{}") as { parentSession?: string };
    expect(clonedHeader.parentSession).toBe(path.resolve(parentFile));
    expect(fs.readFileSync(parentFile, "utf-8")).toContain("empty-session");
  });
});
