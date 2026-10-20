import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  it("boots through the shared denied-host primitive over the durable store, and does not call platform fetch", () => {
    const source = readFileSync(new URL("./bootVsixHost.ts", import.meta.url), "utf8");
    const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(specifiers).toEqual([
      "@builderforce/local-first",
      "./durableLocalFirstStore",
    ]);
    expect(source).toContain("bootDeniedHost(");
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

  it("keeps a corrupt snapshot cache aside and boots from the journal instead of failing activation", async () => {
    const root = directory();
    const first = bootVsixHost({ network: "denied", directory: root });
    const id = await first.writeDurable({ title: "Kept in the journal" });
    first.stop();
    writeFileSync(path.join(root, VSIX_LOCAL_SNAPSHOT_FILE), "{not-json");

    const second = bootVsixHost({ network: "denied", directory: root });
    await second.ready();
    expect(await second.readRecord(id)).toEqual({ id, title: "Kept in the journal" });
    expect(readdirSync(root).some((name) => name.startsWith(`${VSIX_LOCAL_SNAPSHOT_FILE}.corrupt-`))).toBe(true);
    second.stop();
  });

  it("refuses a network that is not denied and a stopped boot", async () => {
    const root = directory();
    expect(() => bootVsixHost({ network: "open" as "denied", directory: root })).toThrow("vsix_boot_requires_denied_network");
    const boot = bootVsixHost({ network: "denied", directory: root });
    boot.stop();
    await expect(boot.writeDurable({ title: "late" })).rejects.toThrow("vsix_boot_stopped");
  });
});
