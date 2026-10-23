import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leaseBusy } from "@builderforce/local-first";
import { createVsCodeLocalFirstStore } from "./localFirstStore";
import {
  LOCAL_FIRST_BUSY_TIMEOUT_MS,
  THIS_HOST,
  createLocalFirstFileLock,
  lockHolderLiveness,
} from "./localFirstLock";

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
    // A reclaimed lock's last write can land while the tree is being removed; `maxRetries`
    // retries the ENOTEMPTY that race raises instead of failing the suite on cleanup.
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })),
    );
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

  async function lockDirectory(): Promise<{ root: string; lock: string }> {
    const root = await mkdtemp(nodePath.join(tmpdir(), "bf-local-first-lock-"));
    directories.push(root);
    return { root, lock: nodePath.join(root, "local-first-v1.lock") };
  }

  it("reclaims a lock whose holder process is gone, then commits", async () => {
    const { root, lock } = await lockDirectory();
    // A pid that cannot exist on this machine: process.kill(pid, 0) answers ESRCH.
    writeFileSync(lock, JSON.stringify({
      holder: "crashed-window",
      pid: 2 ** 30,
      hostStartedAt: 1,
      host: hostname(),
      heldSince: Date.now(),
    }));
    const store = createVsCodeLocalFirstStore(host(root));
    const started = Date.now();
    await expect(store.transact(async () => "committed")).resolves.toBe("committed");
    // Reclaimed on proof of death, not after waiting out the busy timeout.
    expect(Date.now() - started).toBeLessThan(LOCAL_FIRST_BUSY_TIMEOUT_MS);
    expect(existsSync(lock)).toBe(false);
  });

  it("reclaims a lock left by a previous process that had this pid", async () => {
    const { root, lock } = await lockDirectory();
    writeFileSync(lock, JSON.stringify({
      holder: "previous-host",
      pid: process.pid,
      hostStartedAt: THIS_HOST.startedAt - 60_000,
      host: THIS_HOST.host,
      heldSince: Date.now(),
    }));
    const store = createVsCodeLocalFirstStore(host(root));
    await expect(store.transact(async () => "ok")).resolves.toBe("ok");
  });

  it("reclaims a lock that names nobody (a create that crashed before writing its holder)", async () => {
    const { root, lock } = await lockDirectory();
    writeFileSync(lock, "");
    const store = createVsCodeLocalFirstStore(host(root));
    await expect(store.transact(async () => "ok")).resolves.toBe("ok");
    writeFileSync(lock, "{\"holder\":");
    await expect(store.transact(async () => "again")).resolves.toBe("again");
  });

  it("keeps a live holder in another process busy, however old its lock is", async () => {
    const { lock } = await lockDirectory();
    writeFileSync(lock, JSON.stringify({
      holder: "other-window",
      pid: 4242,
      hostStartedAt: 1,
      host: THIS_HOST.host,
      heldSince: 1,
    }));
    const contender = createLocalFirstFileLock(lock, { processLiveness: () => "alive", busyTimeoutMs: 80 });
    await expect(contender.acquire()).rejects.toThrow("local_first_store_busy");
    expect(JSON.parse(readFileSync(lock, "utf8")).holder).toBe("other-window");
  });

  it("judges holder liveness on evidence: another machine and a fresh legacy lock stay busy", () => {
    const self = { pid: 100, startedAt: 1_000_000, host: "this-machine" };
    expect(lockHolderLiveness({ holder: "x", pid: 7, host: "other-machine", hostStartedAt: 1 }, self, () => "dead")).toBe("unknown");
    expect(lockHolderLiveness({ holder: "x", pid: 7, host: "this-machine", hostStartedAt: 1 }, self, () => "dead")).toBe("dead");
    expect(lockHolderLiveness({ holder: "x", pid: 7, host: "this-machine", hostStartedAt: 1 }, self, () => "alive")).toBe("alive");
    expect(lockHolderLiveness({ holder: null }, self)).toBe("dead");
    // A lock written by a pre-identity build before this process existed has no live writer.
    expect(lockHolderLiveness({ holder: "legacy", heldSince: 10 }, self)).toBe("dead");
    expect(lockHolderLiveness({ holder: "legacy", heldSince: 2_000_000 }, self)).toBe("unknown");
    // Our own pid and start, but no holder of that id in this process: a commit that never released.
    expect(lockHolderLiveness({ holder: "leaked", pid: 100, host: "this-machine", hostStartedAt: 1_000_000 }, self, () => "alive", () => false)).toBe("dead");
    expect(lockHolderLiveness({ holder: "live", pid: 100, host: "this-machine", hostStartedAt: 1_000_000 }, self, () => "alive", () => true)).toBe("alive");
  });
});
