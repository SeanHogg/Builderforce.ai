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
}));

vi.mock("@seanhogg/builderforce-brain-embedded", () => ({
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
import {
  attributeRunChanges,
  changeSetIdentityForHostRun,
  finalizeRunChangeSets,
  recordChangeSetAroundRun,
  type LocalChangeSetValue,
} from "./runChangeSets";

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
    const records = snapshot.records.filter((record) => record.entityType === "change-set");
    expect(records).toHaveLength(1);
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
    expect(snapshot.events[0]?.dependsOn).toEqual(["execution:start:run-1"]);
    expect(snapshot.records.some((record) => record.entityType === "execution")).toBe(false);

    await fs.writeFile(path.join(root, "edited.ts"), "changed again\n");
    const again = await finalizeRunChangeSets(
      store,
      { deviceId: "device-1" },
      { runId: "run-1", baseline: { capturedAt: "x", repos: [] }, author: "someone-else" },
    );
    expect(again).toEqual([records[0]?.id]);
    const retried = await store.export();
    expect(retried.records.filter((record) => record.entityType === "change-set")).toHaveLength(1);
    const kept = (retried.records[0]?.payload as LocalChangeSetValue).files.find((file) => file.path === "edited.ts");
    expect(kept?.afterHash).toBe(sha(after));
    expect((retried.records[0]?.payload as LocalChangeSetValue).author).toBe("agent:brain-host");
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
    expect((await store.export()).records).toEqual([]);
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
    expect(snapshot.records).toHaveLength(1);
    expect((snapshot.records[0]?.payload as LocalChangeSetValue).files[0]?.path).toBe("authored.ts");
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
    const records = snapshot.records.filter((record) => record.entityType === "change-set");
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
    expect(snapshot.events[0]?.dependsOn).toEqual([`execution:start:${payload.runId}`]);
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

    const payload = (await store.export()).records[0]?.payload as LocalChangeSetValue;
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
    expect((await store.export()).records).toEqual([]);
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
    const payload = (await store.export()).records[0]?.payload as LocalChangeSetValue;
    expect(payload.files[0]).toEqual(expect.objectContaining({ path: "authored.ts", afterHash: sha(authored) }));
  });
});
