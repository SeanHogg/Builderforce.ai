import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootVsixHost, VSIX_LOCAL_SNAPSHOT_FILE } from "./bootVsixHost";

const directories: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function directory(): string {
  const created = mkdtempSync(path.join(tmpdir(), "vsix-boot-"));
  directories.push(created);
  return created;
}

describe("bootVsixHost", () => {
  it("imports only the denied-network store and does not call platform fetch", () => {
    const source = readFileSync(new URL("./bootVsixHost.ts", import.meta.url), "utf8");
    const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(specifiers).toEqual([
      "node:fs",
      "node:path",
      "@builderforce/local-first",
    ]);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/from\s+["']vscode["']/);
    expect(source).not.toMatch(/from\s+["']\.\/extension["']/);
  });

  it("writes one durable record, restarts, and replays one batch without calling fetch", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("platform fetch must not be called");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const root = directory();

    const first = bootVsixHost({ network: "denied", directory: root });
    await first.ready();
    const id = await first.writeDurable({ title: "Offline ticket" });
    expect(await first.readRecord(id)).toEqual({ id, title: "Offline ticket" });
    first.stop();

    const snapshot = readFileSync(path.join(root, VSIX_LOCAL_SNAPSHOT_FILE), "utf8");
    expect(snapshot).toContain(id);
    expect(fetchSpy).not.toHaveBeenCalled();

    const second = bootVsixHost({ network: "denied", directory: root });
    await second.ready();
    expect(second.store()).not.toBe(first.store());
    expect(await second.readRecord(id)).toEqual({ id, title: "Offline ticket" });
    const replay = await second.replayBatch();
    expect(replay.count).toBe(1);
    expect(replay.idempotencyKey).toBe(`event:${id}`);
    second.stop();

    const third = bootVsixHost({ network: "denied", directory: root });
    await third.ready();
    expect(await third.replayBatch()).toEqual({ count: 0, idempotencyKey: replay.idempotencyKey });
    expect(await third.readRecord(id)).toEqual({ id, title: "Offline ticket" });
    expect(fetchSpy).not.toHaveBeenCalled();
    third.stop();
  });

  it("refuses a corrupt snapshot instead of reporting an empty store", async () => {
    const root = directory();
    writeFileSync(path.join(root, VSIX_LOCAL_SNAPSHOT_FILE), "{not-json");
    expect(() => bootVsixHost({ network: "denied", directory: root })).toThrow("local_first_snapshot_corrupt");
  });
});
