import { beforeEach, describe, expect, it, vi } from "vitest";

const git = vi.hoisted(() => ({
  detect: vi.fn(() => {
    throw new Error("recorder must not read git");
  }),
  refresh: vi.fn(() => {
    throw new Error("recorder must not refresh git");
  }),
  runGit: vi.fn((_cwd: string, _args: string): never => {
    throw new Error("recorder must not shell out to git");
  }),
}));

vi.mock("./gitChanges", () => ({
  detectPendingChanges: () => git.detect(),
  refreshPendingChanges: () => git.refresh(),
}));

vi.mock("./gitApi", () => ({
  runGit: (cwd: string, args: string) => git.runGit(cwd, args),
}));

vi.mock("vscode", () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: "/ws" } }] },
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  },
  Disposable: class {
    static from() {
      return { dispose() {} };
    }
    dispose() {}
  },
}));

import { attributeRunChanges, runChangeSetId, type RunChangeBaseline } from "./runChangeSets";
import {
  finalizeRecordedChangeSet,
  recordRunChangeSet,
  type BaselineFinalizePort,
  type CurrentFileReading,
  type RecordedChangeSet,
} from "./runChangeSetRecorder";

const ROOT = "/ws/repo";
const OTHER = "/ws/other";
const NOW = new Date("2026-10-18T12:00:00.000Z");

function baselineOf(files: Record<string, string | undefined>, root = ROOT): RunChangeBaseline {
  return {
    capturedAt: "2026-10-18T11:00:00.000Z",
    repos: [
      {
        root,
        name: "repo",
        repository: "https://example.test/acme/repo.git",
        branch: "main",
        baseCommit: "abc123",
        files,
      },
    ],
  };
}

function reading(
  relativePath: string,
  hash: string | undefined,
  status = "modified",
  root = ROOT,
): CurrentFileReading {
  return {
    root,
    relativePath,
    status,
    hash,
    repository: "https://example.test/acme/repo.git",
    branch: "main",
    baseCommit: "abc123",
  };
}

function fakePort(options: {
  baseline: RunChangeBaseline;
  current: () => CurrentFileReading[];
  baselineError?: Error;
}): { port: BaselineFinalizePort; writes: RecordedChangeSet[]; order: string[] } {
  const stored = new Map<string, RecordedChangeSet>();
  const writes: RecordedChangeSet[] = [];
  const order: string[] = [];
  const port: BaselineFinalizePort = {
    async baseline() {
      order.push("baseline");
      if (options.baselineError) throw options.baselineError;
      return options.baseline;
    },
    async current() {
      order.push("current");
      return options.current();
    },
    async read(id) {
      order.push(`read:${id}`);
      return stored.get(id);
    },
    async write(record) {
      order.push(`write:${record.id}`);
      if (stored.has(record.id)) throw new Error(`second write of ${record.id}`);
      stored.set(record.id, record);
      writes.push(record);
    },
  };
  return { port, writes, order };
}

beforeEach(() => {
  git.detect.mockClear();
  git.refresh.mockClear();
  git.runGit.mockClear();
});

describe("recordRunChangeSet", () => {
  it("baselines before the run and finalizes after, claiming only hashes that moved", async () => {
    let phase: "baseline" | "final" = "baseline";
    const baseline = baselineOf({ "untouched.ts": "sha256:1", "edited.ts": "sha256:before" });
    const { port, writes, order } = fakePort({
      baseline,
      current: () =>
        phase === "baseline"
          ? []
          : [
              reading("untouched.ts", "sha256:1"),
              reading("edited.ts", "sha256:after"),
              reading("authored.ts", "sha256:new", "untracked"),
            ],
    });

    const settled = await recordRunChangeSet({ runId: "run-1", port, now: () => NOW }, async () => {
      expect(order).toEqual(["baseline"]);
      phase = "final";
      return "settled";
    });

    expect(settled).toBe("settled");
    expect(order[0]).toBe("baseline");
    expect(order.indexOf("current")).toBeGreaterThan(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.id).toBe(runChangeSetId("run-1", ROOT));
    expect(writes[0]?.capturedAt).toBe(NOW.toISOString());
    expect(writes[0]?.repository).toBe("https://example.test/acme/repo.git");
    expect(writes[0]?.branch).toBe("main");
    expect(writes[0]?.baseCommit).toBe("abc123");
    expect(writes[0]?.files).toEqual(
      attributeRunChanges(baseline.repos[0]!.files, [
        { relativePath: "untouched.ts", status: "modified", hash: "sha256:1" },
        { relativePath: "edited.ts", status: "modified", hash: "sha256:after" },
        { relativePath: "authored.ts", status: "untracked", hash: "sha256:new" },
      ]),
    );
    expect(writes[0]?.files.map((file) => file.relativePath)).toEqual(["authored.ts", "edited.ts"]);
    expect(writes[0]?.files.some((file) => file.relativePath === "untouched.ts")).toBe(false);
    expect(git.detect).not.toHaveBeenCalled();
    expect(git.refresh).not.toHaveBeenCalled();
    expect(git.runGit).not.toHaveBeenCalled();
  });

  it("does not write when every hash is unchanged", async () => {
    const { port, writes } = fakePort({
      baseline: baselineOf({ "untouched.ts": "sha256:1" }),
      current: () => [reading("untouched.ts", "sha256:1")],
    });

    await recordRunChangeSet({ runId: "run-still", port }, async () => undefined);

    expect(writes).toEqual([]);
  });

  it("still runs when the baseline cannot be read, and does not finalize", async () => {
    const { port, writes, order } = fakePort({
      baseline: baselineOf({}),
      baselineError: new Error("port down"),
      current: () => [reading("authored.ts", "sha256:new", "untracked")],
    });

    await expect(recordRunChangeSet({ runId: "run-down", port }, async () => "ran")).resolves.toBe("ran");
    expect(writes).toEqual([]);
    expect(order).toEqual(["baseline"]);
  });

  it("finalizes even when the run throws", async () => {
    const { port, writes } = fakePort({
      baseline: baselineOf({}),
      current: () => [reading("authored.ts", "sha256:new", "untracked")],
    });

    await expect(
      recordRunChangeSet({ runId: "run-fail", port, now: () => NOW }, async () => {
        throw new Error("run failed");
      }),
    ).rejects.toThrow("run failed");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.files[0]).toMatchObject({
      relativePath: "authored.ts",
      attribution: "run-authored",
      afterHash: "sha256:new",
    });
  });
});

describe("finalizeRecordedChangeSet", () => {
  it("returns the stored record on retry and does not write a second one", async () => {
    let after = "sha256:after";
    const { port, writes } = fakePort({
      baseline: baselineOf({ "edited.ts": "sha256:before" }),
      current: () => [reading("edited.ts", after)],
    });
    const baseline = baselineOf({ "edited.ts": "sha256:before" });

    const first = await finalizeRecordedChangeSet({ runId: "run-1", baseline, port, now: () => NOW });
    expect(first).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect(first[0]).toBe(writes[0]);

    after = "sha256:changed-again";
    const again = await finalizeRecordedChangeSet({
      runId: "run-1",
      baseline,
      port,
      now: () => new Date("2026-10-18T13:00:00.000Z"),
    });

    expect(again).toEqual(first);
    expect(again[0]).toBe(writes[0]);
    expect(writes).toHaveLength(1);
    expect(again[0]?.files[0]?.afterHash).toBe("sha256:after");
    expect(again[0]?.capturedAt).toBe(NOW.toISOString());
  });

  it("does not claim an unchanged file in one repo when another repo was authored", async () => {
    const baseline: RunChangeBaseline = {
      capturedAt: "2026-10-18T11:00:00.000Z",
      repos: [
        { ...baselineOf({ "keep.ts": "sha256:same" }).repos[0]!, root: ROOT },
        {
          root: OTHER,
          name: "other",
          repository: "https://example.test/acme/other.git",
          branch: "dev",
          baseCommit: "def456",
          files: {},
        },
      ],
    };
    const { port, writes } = fakePort({
      baseline,
      current: () => [
        reading("keep.ts", "sha256:same", "modified", ROOT),
        reading("new.ts", "sha256:fresh", "untracked", OTHER),
      ],
    });

    const records = await finalizeRecordedChangeSet({ runId: "run-2", baseline, port, now: () => NOW });

    expect(writes).toHaveLength(1);
    expect(records).toEqual(writes);
    expect(records[0]?.id).toBe(runChangeSetId("run-2", OTHER));
    expect(records[0]?.repository).toBe("https://example.test/acme/other.git");
    expect(records[0]?.files).toEqual([
      {
        relativePath: "new.ts",
        status: "untracked",
        afterHash: "sha256:fresh",
        attribution: "run-authored",
      },
    ]);
  });
});
