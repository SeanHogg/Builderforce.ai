/** Run delta hardening: validated git arguments, symlink-safe Open code, and the time-bounded overlap read. */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore, newLocalRecord, type LocalFirstStore, type LocalFirstTransaction } from "@builderforce/local-first";

vi.mock("vscode", () => ({ workspace: { workspaceFolders: [] }, l10n: { t: (m: string) => m } }));
vi.mock("../gitChanges", () => ({ refreshPendingChanges: () => undefined, detectPendingChanges: async () => ({ total: 0, repos: [] }) }));
import type { ChangeSetLifecycleValue } from "../changeSetLifecycle";
import type { LocalChangeSetValue } from "../runChangeSets";
import { overlappingRun, windowDays } from "./attribution";
import { isCommitId, repoGit } from "./gitSide";
import { realFileUnder } from "./openCode";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("git argument hardening", () => {
  it("accepts only full object ids", () => {
    expect(isCommitId(SHA)).toBe(true);
    expect(isCommitId("a".repeat(64))).toBe(true);
    expect(isCommitId("abc123")).toBe(false);
    expect(isCommitId("HEAD")).toBe(false);
    expect(isCommitId(`-${SHA.slice(1)}`)).toBe(false);
    expect(isCommitId("--output=/tmp/x")).toBe(false);
    expect(isCommitId(`${SHA}..HEAD`)).toBe(false);
  });

  it("regression: refuses a commit-ish that starts with '-' before git is asked", async () => {
    const git = repoGit(await tempDir("bf-gitside-"));
    expect(await git.isAncestor("--output=/tmp/pwned", SHA)).toBeUndefined();
    expect(await git.isAncestor(SHA, "-c")).toBeUndefined();
    expect(await git.blobs("--batch-all-objects", ["a.ts"])).toBeUndefined();
  });
});

describe("Open code resolves symlinks", () => {
  it("regression: refuses a file reached through a link inside the repository that points outside it", async () => {
    const root = await tempDir("bf-open-root-");
    const outside = await tempDir("bf-open-outside-");
    await fs.writeFile(path.join(outside, "secret.txt"), "secret\n");
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "a.ts"), "a\n");
    expect(await realFileUnder(root, path.join(root, "src", "a.ts"))).toBe(path.join(root, "src", "a.ts"));
    expect(await realFileUnder(root, path.join(root, "src", "missing.ts"))).toBeUndefined();
    const linked = await fs.symlink(outside, path.join(root, "linked"), "junction").then(() => true, () => false);
    if (!linked) return; // links cannot be made here; the textual containment (`confinedPath`) still holds
    expect(await realFileUnder(root, path.join(root, "linked", "secret.txt"))).toBeUndefined();
  });
});

/** A store whose index reads are recorded (the keys asked for). */
function recordingStore(store: LocalFirstStore, keys: unknown[]): LocalFirstStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop !== "read") return Reflect.get(target, prop, receiver);
      return <T>(fn: (tx: LocalFirstTransaction) => Promise<T>) => target.read((tx) => fn(new Proxy(tx, {
        get(t, p, r) {
          if (p !== "scanIndex") return Reflect.get(t, p, r);
          const scan = t.scanIndex!.bind(t);
          return ((index, key, visit) => { keys.push(key); return scan(index, key, visit); }) as NonNullable<LocalFirstTransaction["scanIndex"]>;
        },
      })));
    },
  });
}

describe("overlap read is bounded by time", () => {
  it("lists the UTC days of a window, plus one for a clock ahead", () => {
    expect(windowDays("2026-11-09T23:00:00.000Z", "2026-11-10T01:00:00.000Z")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(windowDays("not a time", "2026-11-10T01:00:00.000Z")).toEqual(["2026-11-10", "2026-11-11"]);
    expect(windowDays("1990-01-01T00:00:00.000Z", "2026-11-10T01:00:00.000Z").length).toBeLessThanOrEqual(402);
  });

  it("reads only the window's days, and still finds a change set finalized inside it", async () => {
    const store = createMemoryLocalFirstStore();
    const repo = "https://github.com/org/repo.git";
    const put = (id: string, runId: string, capturedAt: string) => store.transact(async (tx) => {
      await tx.put(newLocalRecord<LocalChangeSetValue>({
        id, entityType: "change-set", deviceId: "device-1",
        payload: { runId, repository: repo, author: "agent:other", capturedAt, files: [] },
      }));
    });
    // A year of history before the run: never read.
    for (let d = 1; d <= 365; d++) await put(`changeset:old-${d}:k`, `old-${d}`, new Date(Date.parse("2026-11-10T00:00:00.000Z") - d * 86_400_000).toISOString());
    const scope = { runId: "run-me", repository: repo, since: "2026-11-10T10:00:00.000Z", until: "2026-11-10T10:30:00.000Z" };

    const keys: unknown[] = [];
    expect(await overlappingRun(recordingStore(store, keys), scope)).toBe(false);
    expect(keys.filter((k) => String(k).startsWith(repo)).map((k) => String(k).split("\n")[1])).toEqual(["2026-11-10", "2026-11-11"]);

    await put("changeset:other:k", "run-other", "2026-11-10T10:10:00.000Z");
    expect(await overlappingRun(store, scope)).toBe(true);
  });

  it("finds a run still in flight through the day-keyed open lifecycles", async () => {
    const store = createMemoryLocalFirstStore();
    const repo = "/repo/live";
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord<ChangeSetLifecycleValue>({
        id: "changeset-lifecycle:run-live", entityType: "change-set", deviceId: "device-1",
        payload: {
          kind: "lifecycle", runId: "run-live", repository: repo, files: [], author: "agent:other", baselineHash: "sha256:x",
          baseline: { capturedAt: "2026-11-10T09:00:00.000Z", repos: [{ root: repo, name: "live", repository: repo, files: {} }] },
        },
      }));
    });
    const scope = { runId: "run-me", repository: repo, since: "2026-11-10T10:00:00.000Z", until: "2026-11-10T10:30:00.000Z" };
    expect(await overlappingRun(store, scope)).toBe(true);
    expect(await overlappingRun(store, { ...scope, repository: "/repo/other" })).toBe(false);
  });
});
