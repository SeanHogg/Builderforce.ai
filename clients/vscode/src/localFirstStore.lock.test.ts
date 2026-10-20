import { existsSync, readFileSync, statSync, utimesSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leaseBusy } from "@builderforce/local-first";
import {
  LOCAL_FIRST_BUSY_TIMEOUT_MS,
  createVsCodeLocalFirstStore,
} from "./localFirstStore";

vi.mock("vscode", () => ({
  l10n: { t: (message: string) => message },
}));

type Host = Parameters<typeof createVsCodeLocalFirstStore>[0];

function host(directory: string): Host {
  return {
    globalStorageUri: { fsPath: directory },
  } as unknown as Host;
}

describe("local-first file lock", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("polls and throws busy without stealing a lock older than 30s, then acquires after release", async () => {
    const root = await mkdtemp(nodePath.join(tmpdir(), "bf-local-first-lock-"));
    directories.push(root);
    const lock = nodePath.join(root, "local-first-v1.lock");
    const first = createVsCodeLocalFirstStore(host(root));
    const second = createVsCodeLocalFirstStore(host(root));

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = first.transact(async () => {
      await held;
    });

    const appeared = Date.now() + 5_000;
    while (!existsSync(lock)) {
      if (Date.now() > appeared) throw new Error("lock was not acquired");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const stale = new Date(Date.now() - 60_000);
    utimesSync(lock, stale, stale);
    expect(Date.now() - statSync(lock).mtimeMs).toBeGreaterThan(30_000);
    expect(LOCAL_FIRST_BUSY_TIMEOUT_MS).not.toBe(30_000);
    expect(LOCAL_FIRST_BUSY_TIMEOUT_MS).toBeLessThan(30_000);

    const started = Date.now();
    await expect(second.transact(async () => undefined)).rejects.toThrow("local_first_store_busy");
    expect(Date.now() - started).toBeGreaterThanOrEqual(LOCAL_FIRST_BUSY_TIMEOUT_MS - 50);

    const heldLease = JSON.parse(readFileSync(lock, "utf8")) as { holder?: string; heldSince?: number };
    expect(typeof heldLease.holder).toBe("string");
    expect(heldLease.holder?.length).toBeGreaterThan(0);
    expect(leaseBusy(heldLease.holder ?? null, Date.now(), heldLease.heldSince ?? 0)).toBe(true);
    expect(leaseBusy(heldLease.holder ?? null, (heldLease.heldSince ?? 0) + 60_000, heldLease.heldSince ?? 0)).toBe(true);
    expect(existsSync(lock)).toBe(true);
    expect(Date.now() - statSync(lock).mtimeMs).toBeGreaterThan(30_000);

    release();
    await running;
    expect(existsSync(lock)).toBe(false);

    await expect(second.transact(async () => undefined)).resolves.toBeUndefined();
    expect(existsSync(lock)).toBe(false);
  });
});
