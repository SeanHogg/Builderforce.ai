import { describe, expect, it } from "vitest";
import { createRunnerLock, pidAlive, type LockFs } from "./runnerLock";

function memFs(): LockFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    createExclusive: (f, c) => (files.has(f) ? false : (files.set(f, c), true)),
    read: (f) => files.get(f),
    remove: (f) => void files.delete(f),
  };
}

const FILE = "/data/runner.lock";

function lock(fs: LockFs, pid: number, sessionId: string, alivePids: number[]) {
  return createRunnerLock({ file: async () => FILE, pid, sessionId, isAlive: (p) => alivePids.includes(p), fs });
}

describe("runnerLock", () => {
  it("the first window takes it and a second live window is refused", async () => {
    const fs = memFs();
    const a = lock(fs, 100, "a", [100, 200]);
    const b = lock(fs, 200, "b", [100, 200]);
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    expect(await b.heldByOther()).toBe(true);
    expect(await a.heldByOther()).toBe(false);
  });

  it("is re-entrant for the same session", async () => {
    const fs = memFs();
    const a = lock(fs, 100, "a", [100]);
    expect(await a.acquire()).toBe(true);
    expect(await a.acquire()).toBe(true);
  });

  it("takes over a lock whose owner is no longer alive", async () => {
    const fs = memFs();
    fs.files.set(FILE, JSON.stringify({ pid: 999, sessionId: "dead" }));
    const b = lock(fs, 200, "b", [200]);
    expect(await b.heldByOther()).toBe(false);
    expect(await b.acquire()).toBe(true);
    expect(JSON.parse(fs.files.get(FILE)!)).toEqual({ pid: 200, sessionId: "b" });
  });

  it("takes over an unreadable lock file", async () => {
    const fs = memFs();
    fs.files.set(FILE, "{half");
    expect(await lock(fs, 200, "b", [200]).acquire()).toBe(true);
  });

  it("release frees only our own lock", async () => {
    const fs = memFs();
    const a = lock(fs, 100, "a", [100, 200]);
    const b = lock(fs, 200, "b", [100, 200]);
    await a.acquire();
    await b.release();
    expect(fs.files.has(FILE)).toBe(true);
    await a.release();
    expect(fs.files.has(FILE)).toBe(false);
    expect(await b.acquire()).toBe(true);
  });
});

describe("pidAlive", () => {
  it("sees this process, and not an impossible pid", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2 ** 22 + 12345)).toBe(false);
  });
});
