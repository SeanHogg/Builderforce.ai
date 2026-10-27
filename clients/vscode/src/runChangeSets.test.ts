import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import type { PendingChange, PendingChangeRepo, PendingChangeSet, PendingChangeStatus } from "./gitChangeModel";

const git = vi.hoisted(() => ({
  detect: vi.fn(),
  refresh: vi.fn(),
  runGit: vi.fn(),
}));

const hostPorts = vi.hoisted(() => ({
  store: null as import("@builderforce/local-first").LocalFirstStore | null,
  running: false,
  innerStart: vi.fn(async (_payload: { chatId: number }) => undefined),
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
  l10n: { t: (message: string) => message },
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  },
}));

vi.mock("@seanhogg/builderforce-brain-embedded", async (importOriginal) => ({
  // The rest stays real: modules this test loads (localModels → the page-engine
  // bridge) call into the package when they are imported.
  ...(await importOriginal<typeof import("@seanhogg/builderforce-brain-embedded")>()),
  isRunning: () => hostPorts.running,
}));

vi.mock("./gateway", () => ({
  getApiKey: async () => "",
  postRunOutcome: async () => undefined,
}));

vi.mock("./bfApi", () => ({
  fetchRunContextSection: async () => "",
  projectEvermindHooks: () => ({}),
}));

vi.mock("./localFirstStore", () => ({
  localBrainApplication: () => ({
    store: hostPorts.store,
    persistence: { sendMessages: async () => [] },
  }),
}));

// Host start also journals the run. That journal is not the change set, and a
// shared store would make records[0] the recovery row. G22 covers the journal.
vi.mock("./installRunRecovery", () => ({
  installRunRecovery: () => ({
    recovered: Promise.resolve([]),
    recordStarted: async () => undefined,
    recordCheckpoint: async () => undefined,
    recordFinished: async () => undefined,
  }),
}));

vi.mock("./auditToolCatalog", () => ({
  auditToolCatalog: async (_secrets: unknown, tools: unknown) => tools,
}));

vi.mock("./brainToolCatalog", () => ({ brainToolCatalog: async () => [] }));

vi.mock("./modelRouting", () => ({
  localWindowProbes: async () => ({}),
  resolveModelRoute: async () => ({}),
  routeStream: () => async () => undefined,
}));

vi.mock("./sessionNotes", () => ({ appendSessionNote: async () => undefined }));

vi.mock("./attention", () => ({ setLocalChatRuns: () => undefined }));

vi.mock("./brainRunHost", () => ({
  createBrainRunHost: () => ({
    start: (payload: { chatId: number }) => hostPorts.innerStart(payload),
    stop() {},
    confirm() {},
    clearError() {},
    setAutoApprove() {},
    steer() {},
    childControls: () => ({}),
    attach: () => () => undefined,
    dispose() {},
  }),
}));

vi.mock("./policyGates", () => ({ resolveRunPolicyGates: async () => ({}) }));

vi.mock("./hooks/editorDirectives", () => ({ editorRunDirectives: async () => [] }));

vi.mock("./memoryStaleness", () => ({ withWorkspaceStaleness: (hooks: unknown) => hooks }));

import { createVsCodeRunHost } from "./brainRunHostPorts";
import { attributeRunChanges, FINGERPRINT_HASH_MAX_BYTES, fingerprintFile, fingerprintFiles } from "./runChangeBaseline";
import {
  beginChangeSet,
  changeSetCompleteness,
  finishChangeSet,
  hashRunChangeBaseline,
  isChangeSetLifecycle,
  readChangeSetLifecycle,
  readRunChangeSetPhase,
  recordChangeSetBaseline,
  recordChangeSetFinalization,
} from "./changeSetLifecycle";
import {
  changeSetIdentityForHostRun,
  finalizeRunChangeSets,
  recordChangeSetAroundRun,
  type LocalChangeSetValue,
} from "./runChangeSets";

function attributedChangeSets<T extends { entityType: string; payload: unknown }>(records: T[]): T[] {
  return records.filter((record) => record.entityType === "change-set" && !isChangeSetLifecycle(record.payload));
}

const roots: string[] = [];

function sha(text: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;
}

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bf-changeset-"));
  roots.push(root);
  return root;
}

function change(root: string, relativePath: string, status: PendingChangeStatus): PendingChange {
  return { path: path.join(root, relativePath), relativePath, repoRoot: root, status, staged: false };
}

function repo(root: string, changes: PendingChange[]): PendingChangeRepo {
  return { root, name: "repo", branch: "main", changes };
}

function pending(repos: PendingChangeRepo[]): PendingChangeSet {
  return { total: repos.reduce((count, item) => count + item.changes.length, 0), repos };
}

beforeEach(() => {
  git.detect.mockReset();
  git.refresh.mockReset();
  git.runGit.mockReset();
  hostPorts.store = null;
  hostPorts.running = false;
  hostPorts.innerStart.mockReset();
  hostPorts.innerStart.mockResolvedValue(undefined);
  git.runGit.mockImplementation(async (_cwd: string, args: string) => {
    if (args.includes("remote.origin.url")) return "https://example.test/acme/repo.git";
    if (args.startsWith("rev-parse")) return "abc123def456";
    return undefined;
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("attributeRunChanges", () => {
  it("excludes a pre-existing dirty file whose hash did not move", () => {
    expect(
      attributeRunChanges(
        { "a.ts": "sha256:1" },
        [{ relativePath: "a.ts", status: "modified", hash: "sha256:1" }],
      ),
    ).toEqual([]);
  });

  it("keeps beforeHash when the run changes an already-dirty file", () => {
    expect(
      attributeRunChanges(
        { "a.ts": "sha256:1" },
        [{ relativePath: "a.ts", status: "modified", hash: "sha256:2" }],
      ),
    ).toEqual([
      {
        relativePath: "a.ts",
        status: "modified",
        beforeHash: "sha256:1",
        afterHash: "sha256:2",
        attribution: "run-modified-existing",
      },
    ]);
  });

  it("marks a file that was clean at baseline as run-authored", () => {
    expect(
      attributeRunChanges({}, [{ relativePath: "b.ts", status: "untracked", hash: "sha256:3" }]),
    ).toEqual([
      {
        relativePath: "b.ts",
        status: "untracked",
        afterHash: "sha256:3",
        attribution: "run-authored",
      },
    ]);
  });
});

describe("changeSetIdentityForHostRun", () => {
  it("keeps an audit run id and labels the author as the agent", () => {
    expect(changeSetIdentityForHostRun({ chatId: 7, audit: { runId: "audit-run" } }, () => "x")).toEqual({
      runId: "audit-run",
      author: "agent:audit",
    });
  });

  it("gives every other start its own id so a later turn is not dropped", () => {
    expect(changeSetIdentityForHostRun({ chatId: 7 }, () => "uuid")).toEqual({
      runId: "host-run:7:uuid",
      author: "agent:brain-host",
    });
    expect(changeSetIdentityForHostRun({ chatId: 7, audit: { runId: "  " } }, () => "uuid")).toEqual({
      runId: "host-run:7:uuid",
      author: "agent:audit",
    });
  });
});

describe("recordChangeSetAroundRun", () => {
  it("records repo identity, branch, base commit, paths, and before/after hashes without claiming an untouched edit", async () => {
    const root = await workspace();
    const other = await workspace();
    const otherFile = path.join(other, "untouched.txt");
    await fs.writeFile(otherFile, "do not apply here\n");
    const untouched = "pre-existing user edit\n";
    const before = "half-written\n";
    const after = "half-written\nagent finished\n";
    const authored = "new from the run\n";
    await fs.writeFile(path.join(root, "untouched.ts"), untouched);
    await fs.writeFile(path.join(root, "edited.ts"), before);

    let phase: "baseline" | "final" = "baseline";
    const calls: string[] = [];
    git.refresh.mockImplementation(() => calls.push("refresh"));
    git.detect.mockImplementation(async () => {
      calls.push("detect");
      return phase === "baseline"
        ? pending([repo(root, [change(root, "untouched.ts", "modified"), change(root, "edited.ts", "modified")])])
        : pending([
            repo(root, [
              change(root, "untouched.ts", "modified"),
              change(root, "edited.ts", "modified"),
              change(root, "authored.ts", "untracked"),
            ]),
          ]);
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const store = createMemoryLocalFirstStore();

    const settled = await recordChangeSetAroundRun(
      { store, deviceId: "device-1", runId: "run-1", author: "agent:brain-host" },
      async () => {
        expect(calls).toEqual(["refresh", "detect"]);
        await fs.writeFile(path.join(root, "edited.ts"), after);
        await fs.writeFile(path.join(root, "authored.ts"), authored);
        phase = "final";
        return "settled";
      },
    );

    expect(settled).toBe("settled");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await fs.readFile(otherFile, "utf8")).toBe("do not apply here\n");
    const snapshot = await store.export();
    const records = attributedChangeSets(snapshot.records);
    expect(records).toHaveLength(1);
    expect(await readRunChangeSetPhase(store, "run-1")).toBe("finished");
    expect(records[0]?.provenance?.deviceId).toBe("device-1");
    expect(records[0]?.destination).toEqual({ kind: "unbound" });
    const payload = records[0]?.payload as LocalChangeSetValue;
    expect(payload.repository).toBe("https://example.test/acme/repo.git");
    expect(payload.branch).toBe("main");
    expect(payload.baseCommit).toBe("abc123def456");
    expect(payload.author).toBe("agent:brain-host");
    expect(payload.runId).toBe("run-1");
    expect(payload.files.map((file) => file.path).sort()).toEqual(["authored.ts", "edited.ts"]);
    const edited = payload.files.find((file) => file.path === "edited.ts");
    expect(edited).toMatchObject({
      beforeHash: sha(before),
      afterHash: sha(after),
      attribution: "run-modified-existing",
    });
    const created = payload.files.find((file) => file.path === "authored.ts");
    expect(created).toMatchObject({ afterHash: sha(authored), attribution: "run-authored" });
    expect(created?.beforeHash).toBeUndefined();
    expect(payload.files.some((file) => file.path === "untouched.ts")).toBe(false);
    expect(payload.files.every((file) => file.patchManifestId == null)).toBe(true);
    // A pending `execution:start` event is referenced by its wire id; otherwise the key is kept.
    const startEvent = snapshot.events.find((event) => event.idempotencyKey === "execution:start:run-1");
    expect(snapshot.events[0]?.dependsOn).toEqual([startEvent?.eventId ?? "execution:start:run-1"]);
    expect(snapshot.records.some((record) => record.entityType === "execution")).toBe(false);

    await fs.writeFile(path.join(root, "edited.ts"), "changed again\n");
    const again = await finalizeRunChangeSets(
      store,
      { deviceId: "device-1" },
      { runId: "run-1", baseline: { capturedAt: "x", repos: [] }, author: "someone-else" },
    );
    expect(again).toEqual([records[0]?.id]);
    const retried = await store.export();
    const retriedSets = attributedChangeSets(retried.records);
    expect(retriedSets).toHaveLength(1);
    const kept = (retriedSets[0]?.payload as LocalChangeSetValue).files.find((file) => file.path === "edited.ts");
    expect(kept?.afterHash).toBe(sha(after));
    expect((retriedSets[0]?.payload as LocalChangeSetValue).author).toBe("agent:brain-host");
  });

  it("does not finalize a start that does not own the live run", async () => {
    const store = createMemoryLocalFirstStore();
    git.detect.mockResolvedValue(pending([]));
    const skipped = await recordChangeSetAroundRun(
      { store, deviceId: "device-1", runId: "run-2", author: "agent:brain-host", stillRunning: () => true },
      async () => "noop",
    );
    expect(skipped).toBe("noop");
    expect(git.detect).not.toHaveBeenCalled();
    expect((await store.export()).records).toEqual([]);

    let checks = 0;
    await recordChangeSetAroundRun(
      {
        store,
        deviceId: "device-1",
        runId: "run-3",
        author: "agent:brain-host",
        stillRunning: () => {
          checks += 1;
          return checks > 1;
        },
      },
      async () => undefined,
    );
    const snapshot = await store.export();
    expect(attributedChangeSets(snapshot.records)).toEqual([]);
    expect(await readRunChangeSetPhase(store, "run-3")).toBe("partial");
    expect(snapshot.records.find((record) => record.entityType !== "change-set")).toBeUndefined();
  });

  it("does not stamp a blank device id, and still finalizes when the run throws", async () => {
    const store = createMemoryLocalFirstStore();
    git.detect.mockResolvedValue(pending([]));
    await expect(
      recordChangeSetAroundRun(
        { store, deviceId: "", runId: "run-4", author: "agent:brain-host" },
        async () => "ran",
      ),
    ).resolves.toBe("ran");
    expect((await store.export()).records).toEqual([]);

    const root = await workspace();
    await fs.writeFile(path.join(root, "authored.ts"), "from the failed run\n");
    let phase: "baseline" | "final" = "baseline";
    git.detect.mockImplementation(async () =>
      phase === "baseline" ? pending([]) : pending([repo(root, [change(root, "authored.ts", "untracked")])]),
    );
    await expect(
      recordChangeSetAroundRun(
        { store, deviceId: "device-1", runId: "run-5", author: "agent:brain-host" },
        async () => {
          phase = "final";
          throw new Error("run failed");
        },
      ),
    ).rejects.toThrow("run failed");
    const snapshot = await store.export();
    const records = attributedChangeSets(snapshot.records);
    expect(records).toHaveLength(1);
    expect(await readRunChangeSetPhase(store, "run-5")).toBe("finished");
    expect((records[0]?.payload as LocalChangeSetValue).files[0]?.path).toBe("authored.ts");
  });

  it("still runs when the baseline cannot be read", async () => {
    const store = createMemoryLocalFirstStore();
    git.detect.mockRejectedValue(new Error("git down"));
    await expect(
      recordChangeSetAroundRun(
        { store, deviceId: "device-1", runId: "run-6", author: "agent:brain-host" },
        async () => "ran",
      ),
    ).resolves.toBe("ran");
    expect((await store.export()).records).toEqual([]);
  });
});

describe("createVsCodeRunHost change sets", () => {
  function hostContext() {
    return {
      secrets: {},
      globalState: {
        get: (key: string) => (key === "builderforce.localDeviceId" ? "device-host" : undefined),
      },
      workspaceState: {},
    };
  }

  function startPayload(extra: Record<string, unknown> = {}) {
    return { chatId: 42, systemPrompt: "", autoApprove: false, evermind: false, ...extra };
  }

  function installHost() {
    return createVsCodeRunHost(hostContext() as never, {
      onChatsChanged() {},
      onPlatformWrite() {},
    });
  }

  it("records a content-hashed baseline before the run and finalizes only the run's own edits", async () => {
    const root = await workspace();
    const before = "user edit, do not claim\n";
    const authored = "written by the run\n";
    await fs.writeFile(path.join(root, "untouched.ts"), before);
    let phase: "baseline" | "final" = "baseline";
    const order: string[] = [];
    git.refresh.mockImplementation(() => {
      order.push("refresh");
    });
    git.detect.mockImplementation(async () => {
      order.push(`detect:${phase}`);
      return phase === "baseline"
        ? pending([repo(root, [change(root, "untouched.ts", "modified")])])
        : pending([
            repo(root, [
              change(root, "untouched.ts", "modified"),
              change(root, "authored.ts", "untracked"),
            ]),
          ]);
    });
    const store = createMemoryLocalFirstStore();
    hostPorts.store = store;
    hostPorts.innerStart.mockImplementation(async () => {
      order.push("start");
      await fs.writeFile(path.join(root, "authored.ts"), authored);
      phase = "final";
    });
    const upload = vi.fn();
    vi.stubGlobal("fetch", upload);

    await installHost().start(startPayload() as never);

    expect(order).toEqual(["refresh", "detect:baseline", "start", "refresh", "detect:final"]);
    expect(upload).not.toHaveBeenCalled();
    const snapshot = await store.export();
    const records = attributedChangeSets(snapshot.records);
    expect(records).toHaveLength(1);
    expect(records[0]?.provenance?.deviceId).toBe("device-host");
    const payload = records[0]?.payload as LocalChangeSetValue;
    expect(payload.author).toBe("agent:brain-host");
    expect(payload.runId).toMatch(/^host-run:42:/);
    expect(payload.repository).toBe("https://example.test/acme/repo.git");
    expect(payload.branch).toBe("main");
    expect(payload.baseCommit).toBe("abc123def456");
    expect(payload.files).toEqual([
      expect.objectContaining({
        path: "authored.ts",
        afterHash: sha(authored),
        attribution: "run-authored",
      }),
    ]);
    expect(payload.files.some((file) => file.path === "untouched.ts")).toBe(false);
    const startEvent = snapshot.events.find((event) => event.idempotencyKey === `execution:start:${payload.runId}`);
    expect(snapshot.events.find((event) => event.entityType === "change-set")?.dependsOn).toEqual([
      startEvent?.eventId ?? `execution:start:${payload.runId}`,
    ]);
  });

  it("keeps an audit run id when the host starts the run", async () => {
    const root = await workspace();
    const authored = "audit finding\n";
    let phase: "baseline" | "final" = "baseline";
    git.detect.mockImplementation(async () =>
      phase === "baseline" ? pending([]) : pending([repo(root, [change(root, "finding.ts", "untracked")])]),
    );
    const store = createMemoryLocalFirstStore();
    hostPorts.store = store;
    hostPorts.innerStart.mockImplementation(async () => {
      phase = "final";
      await fs.writeFile(path.join(root, "finding.ts"), authored);
    });

    await installHost().start(startPayload({ audit: { auditId: "soc2", runId: "audit-run-9" } }) as never);

    const payload = attributedChangeSets((await store.export()).records)[0]?.payload as LocalChangeSetValue;
    expect(payload.runId).toBe("audit-run-9");
    expect(payload.author).toBe("agent:audit");
    expect(payload.files[0]).toEqual(expect.objectContaining({ path: "finding.ts", afterHash: sha(authored) }));
  });

  it("does not claim the live run's edits when start is called again while that chat is running", async () => {
    const root = await workspace();
    await fs.writeFile(path.join(root, "live.ts"), "already in flight\n");
    git.detect.mockResolvedValue(pending([repo(root, [change(root, "live.ts", "untracked")])]));
    const store = createMemoryLocalFirstStore();
    hostPorts.store = store;
    hostPorts.running = true;

    await installHost().start(startPayload() as never);

    expect(hostPorts.innerStart).toHaveBeenCalledOnce();
    expect(git.refresh).not.toHaveBeenCalled();
    expect(git.detect).not.toHaveBeenCalled();
    expect((await store.export()).records.filter((record) => record.entityType === "change-set")).toEqual([]);
  });

  it("still finalizes when the host run throws", async () => {
    const root = await workspace();
    const authored = "from the failed host run\n";
    let phase: "baseline" | "final" = "baseline";
    git.detect.mockImplementation(async () =>
      phase === "baseline" ? pending([]) : pending([repo(root, [change(root, "authored.ts", "untracked")])]),
    );
    const store = createMemoryLocalFirstStore();
    hostPorts.store = store;
    hostPorts.innerStart.mockImplementation(async () => {
      phase = "final";
      await fs.writeFile(path.join(root, "authored.ts"), authored);
      throw new Error("run failed");
    });

    await expect(installHost().start(startPayload() as never)).rejects.toThrow("run failed");
    const payload = attributedChangeSets((await store.export()).records)[0]?.payload as LocalChangeSetValue;
    expect(payload.files[0]).toEqual(expect.objectContaining({ path: "authored.ts", afterHash: sha(authored) }));
  });
});

describe("change set baseline and finalization", () => {
  it("hashes baseline content independent of clock, key order, and path spelling", () => {
    const baseline = {
      capturedAt: "2026-01-01T00:00:00.000Z",
      repos: [
        {
          root: "C:\\repo",
          name: "repo",
          repository: "https://example.test/acme/repo.git",
          branch: "main",
          baseCommit: "abc",
          files: { "b.ts": "sha256:2", "a.ts": "sha256:1" },
        },
      ],
    };
    const reordered = {
      capturedAt: "different",
      repos: [
        {
          root: "c:/repo",
          name: "repo",
          repository: "https://example.test/acme/repo.git",
          branch: "main",
          baseCommit: "abc",
          files: { "a.ts": "sha256:1", "b.ts": "sha256:2" },
        },
      ],
    };
    expect(hashRunChangeBaseline(baseline)).toBe(hashRunChangeBaseline(reordered));
    expect(hashRunChangeBaseline(baseline)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("treats a baseline without finalization as partial and a finalized set as finished", () => {
    const open = beginChangeSet({
      runId: "run-1",
      author: "agent:brain-host",
      baseline: { capturedAt: "t", repos: [] },
    });
    expect(changeSetCompleteness(open)).toBe("partial");
    expect(open.baselineHash).toMatch(/^sha256:/);
    expect(open.finalizedAt).toBeUndefined();

    const finished = finishChangeSet(open, {
      finalizedAt: "2026-01-02T00:00:00.000Z",
      changeSetIds: ["changeset:run-1:b", "changeset:run-1:a"],
    });
    expect(changeSetCompleteness(finished)).toBe("finished");
    expect(finished.finalizedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(finished.changeSetIds).toEqual(["changeset:run-1:a", "changeset:run-1:b"]);
    expect(finished.finalizationHash).toMatch(/^sha256:/);
    expect(finishChangeSet(finished, { finalizedAt: "later", changeSetIds: ["other"] })).toEqual(finished);
    expect(changeSetCompleteness({ finalizedAt: "t" })).toBe("finished");
    expect(changeSetCompleteness({})).toBe("absent");
  });

  it("records a content-hashed baseline before the run and a finalization after, with no fetch", async () => {
    const store = createMemoryLocalFirstStore();
    git.detect.mockResolvedValue(pending([]));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const now = new Date("2026-04-01T00:00:00.000Z");

    await recordChangeSetAroundRun(
      { store, deviceId: "device-1", runId: "run-open", author: "agent:brain-host", now: () => now },
      async () => {
        expect(await readRunChangeSetPhase(store, "run-open")).toBe("partial");
        const open = await readChangeSetLifecycle(store, "run-open");
        expect(open?.baselineHash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(open?.finalizedAt).toBeUndefined();
        expect(open?.baselineHash).toBe(hashRunChangeBaseline(open!.baseline));
        expect(fetchSpy).not.toHaveBeenCalled();
      },
    );

    expect(await readRunChangeSetPhase(store, "run-open")).toBe("finished");
    const closed = await readChangeSetLifecycle(store, "run-open");
    expect(closed?.finalizedAt).toBe(now.toISOString());
    expect(closed?.finalizationHash).toMatch(/^sha256:/);
    expect(closed?.changeSetIds).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stays partial until finalization, so a restart can tell an unfinished set from a finished one", async () => {
    const store = createMemoryLocalFirstStore();
    const baseline = { capturedAt: "2026-04-01T00:00:00.000Z", repos: [] };
    await recordChangeSetBaseline(
      store,
      { deviceId: "device-1" },
      { runId: "run-partial", baseline, author: "agent:brain-host" },
    );
    expect(await readRunChangeSetPhase(store, "run-partial")).toBe("partial");
    expect(changeSetCompleteness((await readChangeSetLifecycle(store, "run-partial"))!)).toBe("partial");

    const closed = await recordChangeSetFinalization(
      store,
      { deviceId: "device-1", now: () => new Date("2026-04-01T01:00:00.000Z") },
      { runId: "run-partial", baseline, author: "agent:brain-host", changeSetIds: [] },
    );
    expect(await readRunChangeSetPhase(store, "run-partial")).toBe("finished");
    expect(closed.finalizedAt).toBe("2026-04-01T01:00:00.000Z");

    const again = await recordChangeSetFinalization(
      store,
      { deviceId: "device-1", now: () => new Date("2026-04-02T00:00:00.000Z") },
      { runId: "run-partial", baseline, author: "someone-else", changeSetIds: ["new"] },
    );
    expect(again.finalizedAt).toBe("2026-04-01T01:00:00.000Z");
    expect(again.author).toBe("agent:brain-host");
    expect(again.changeSetIds).toEqual([]);
  });
});

describe("bounded baseline fingerprints", () => {
  it("content-hashes small files, fingerprints large ones by size and mtime, and keeps input order", async () => {
    const root = await workspace();
    const small = path.join(root, "small.txt");
    const large = path.join(root, "large.bin");
    await fs.writeFile(small, "hello");
    await fs.writeFile(large, Buffer.alloc(FINGERPRINT_HASH_MAX_BYTES + 1, 1));

    expect(await fingerprintFile(small)).toBe(sha("hello"));
    const largePrint = await fingerprintFile(large);
    expect(largePrint).toMatch(new RegExp(`^stat:${FINGERPRINT_HASH_MAX_BYTES + 1}:\\d+$`));
    expect(await fingerprintFile(path.join(root, "missing"))).toBeUndefined();

    // A change to a large file still shows: its size (or mtime) moves.
    await fs.appendFile(large, Buffer.from([2]));
    expect(await fingerprintFile(large)).not.toBe(largePrint);

    const many = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const file = path.join(root, `f-${index}.txt`);
        await fs.writeFile(file, `file ${index}`);
        return file;
      }),
    );
    expect(await fingerprintFiles(many)).toEqual(many.map((_, index) => sha(`file ${index}`)));
  });
});
