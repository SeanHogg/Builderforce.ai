import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRollingLog } from "./knowledgeRollingLog";

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "kg-rolling-log-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("knowledgeRollingLog", () => {
  it("regression: appended lines survive a new log over the same file, newest last", async () => {
    const file = join(dir, "nested", "knowledge.log");
    const a = createRollingLog(file, { now: () => "T" });
    a.append("one");
    a.append("two\nwith newline");
    await a.tail(1);
    const b = createRollingLog(file, { now: () => "T" });
    expect(await b.tail(10)).toEqual(["T one", "T two ⏎ with newline"]);
    expect(await b.tail(1)).toEqual(["T two ⏎ with newline"]);
  });

  it("regression: stays size-capped by rotating to .1, keeping the newest lines readable", async () => {
    const log = createRollingLog(join(dir, "k.log"), { maxBytes: 200, now: () => "T" });
    for (let i = 0; i < 100; i += 1) log.append(`line ${i}`);
    const lines = await log.tail(1000);
    expect(lines.at(-1)).toBe("T line 99");
    expect(lines.length).toBeLessThan(100);
  });

  it("reports a failed append instead of throwing", async () => {
    const errors: unknown[] = [];
    // The parent "directory" is a file's path component that cannot be created.
    const log = createRollingLog(join(dir, "k.log", "child", "x.log"), { onError: (e) => errors.push(e) });
    const first = createRollingLog(join(dir, "k.log"));
    first.append("blocks the directory");
    await first.tail(1);
    log.append("x");
    await log.tail(1);
    expect(errors.length).toBeGreaterThan(0);
  });
});
