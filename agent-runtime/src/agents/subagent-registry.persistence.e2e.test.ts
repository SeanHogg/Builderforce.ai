import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import {
  initSubagentRegistry,
  registerSubagentRun,
  resetSubagentRegistryForTests,
} from "./subagent-registry.js";
import { loadSubagentRegistryFromDisk } from "./subagent-registry.store.js";

const noop = () => {};

vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(async () => ({
    status: "ok",
    startedAt: 111,
    endedAt: 222,
  })),
}));

vi.mock("../infra/agent-events.js", () => ({
  onAgentEvent: vi.fn(() => noop),
}));

const { announceSpy } = vi.hoisted(() => ({
  announceSpy: vi.fn(async () => true),
}));
vi.mock("./subagent-announce.js", () => ({
  runSubagentAnnounceFlow: announceSpy,
}));

describe("subagent registry persistence", () => {
  const envSnapshot = captureEnv(["BUILDERFORCE_AGENTS_STATE_DIR"]);
  let tempStateDir: string | null = null;

  const writePersistedRegistry = async (persisted: Record<string, unknown>) => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-subagent-"));
    process.env.BUILDERFORCE_AGENTS_STATE_DIR = tempStateDir;
    const registryPath = path.join(tempStateDir, "subagents", "runs.json");
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, `${JSON.stringify(persisted)}\n`, "utf8");
    return registryPath;
  };

  const createPersistedEndedRun = (params: {
    runId: string;
    childSessionKey: string;
    task: string;
    cleanup: "keep" | "delete";
  }) => {
    const now = Date.now();
    return {
      version: 2,
      runs: {
        [params.runId]: {
          runId: params.runId,
          childSessionKey: params.childSessionKey,
          requesterSessionKey: "agent:main:main",
          requesterDisplayKey: "main",
          task: params.task,
          cleanup: params.cleanup,
          createdAt: now - 2,
          startedAt: now - 1,
          endedAt: now,
        },
      },
    };
  };

  const flushQueuedRegistryWork = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  // Restore reads the registry from disk asynchronously, so a restart is only complete
  // once `initSubagentRegistry()`'s promise settles — two microtask turns are not enough.
  const restartRegistryAndFlush = async () => {
    resetSubagentRegistryForTests({ persist: false });
    await initSubagentRegistry();
    await flushQueuedRegistryWork();
  };

  // Announce outcomes persist fire-and-forget too, so a read straight after a restart can
  // see the previous file or a half-written one. Poll until the state the assertion
  // describes has landed on disk.
  const expectPersistedRuns = <T>(
    registryPath: string,
    assert: (runs: Record<string, T> | undefined) => void,
  ) =>
    vi.waitFor(async () => {
      const parsed = JSON.parse(await fs.readFile(registryPath, "utf8")) as {
        runs?: Record<string, T>;
      };
      assert(parsed.runs);
    });

  afterEach(async () => {
    announceSpy.mockClear();
    resetSubagentRegistryForTests({ persist: false });
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = null;
    }
    envSnapshot.restore();
  });

  it("persists runs to disk and resumes after restart", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-subagent-"));
    process.env.BUILDERFORCE_AGENTS_STATE_DIR = tempStateDir;

    registerSubagentRun({
      runId: "run-1",
      childSessionKey: "agent:main:subagent:test",
      requesterSessionKey: "agent:main:main",
      requesterOrigin: { channel: " whatsapp ", accountId: " acct-main " },
      requesterDisplayKey: "main",
      task: "do the thing",
      cleanup: "keep",
    });

    const registryPath = path.join(tempStateDir, "subagents", "runs.json");
    // Registration persists fire-and-forget (`void persistSubagentRuns()`); wait for the write.
    const raw = await vi.waitFor(() => fs.readFile(registryPath, "utf8"));
    const parsed = JSON.parse(raw) as { runs?: Record<string, unknown> };
    expect(parsed.runs && Object.keys(parsed.runs)).toContain("run-1");
    const run = parsed.runs?.["run-1"] as
      | {
          requesterOrigin?: { channel?: string; accountId?: string };
        }
      | undefined;
    expect(run).toBeDefined();
    if (run) {
      expect("requesterAccountId" in run).toBe(false);
      expect("requesterChannel" in run).toBe(false);
    }
    expect(run?.requesterOrigin?.channel).toBe("whatsapp");
    expect(run?.requesterOrigin?.accountId).toBe("acct-main");

    // Simulate a process restart: module re-import should load persisted runs
    // and trigger the announce flow once the run resolves.
    await restartRegistryAndFlush();

    expect(announceSpy).toHaveBeenCalled();

    type AnnounceParams = {
      childSessionKey: string;
      childRunId: string;
      requesterSessionKey: string;
      requesterOrigin?: { channel?: string; accountId?: string };
      task: string;
      cleanup: string;
      label?: string;
    };
    const first = (announceSpy.mock.calls as unknown as Array<[unknown]>)[0]?.[0] as
      | AnnounceParams
      | undefined;
    if (!first) {
      throw new Error("expected announce call");
    }
    expect(first.childSessionKey).toBe("agent:main:subagent:test");
    expect(first.requesterOrigin?.channel).toBe("whatsapp");
    expect(first.requesterOrigin?.accountId).toBe("acct-main");
  });

  it("skips cleanup when cleanupHandled was persisted", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-subagent-"));
    process.env.BUILDERFORCE_AGENTS_STATE_DIR = tempStateDir;

    const registryPath = path.join(tempStateDir, "subagents", "runs.json");
    const persisted = {
      version: 2,
      runs: {
        "run-2": {
          runId: "run-2",
          childSessionKey: "agent:main:subagent:two",
          requesterSessionKey: "agent:main:main",
          requesterDisplayKey: "main",
          task: "do the other thing",
          cleanup: "keep",
          createdAt: 1,
          startedAt: 1,
          endedAt: 2,
          cleanupHandled: true, // Already handled - should be skipped
        },
      },
    };
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, `${JSON.stringify(persisted)}\n`, "utf8");

    await restartRegistryAndFlush();

    // announce should NOT be called since cleanupHandled was true
    const calls = (announceSpy.mock.calls as unknown as Array<[unknown]>).map((call) => call[0]);
    const match = calls.find(
      (params) =>
        (params as { childSessionKey?: string }).childSessionKey === "agent:main:subagent:two",
    );
    expect(match).toBeFalsy();
  });

  it("maps legacy announce fields into cleanup state", async () => {
    const persisted = {
      version: 1,
      runs: {
        "run-legacy": {
          runId: "run-legacy",
          childSessionKey: "agent:main:subagent:legacy",
          requesterSessionKey: "agent:main:main",
          requesterDisplayKey: "main",
          task: "legacy announce",
          cleanup: "keep",
          createdAt: 1,
          startedAt: 1,
          endedAt: 2,
          announceCompletedAt: 9,
          announceHandled: true,
          requesterChannel: "whatsapp",
          requesterAccountId: "legacy-account",
        },
      },
    };
    const registryPath = await writePersistedRegistry(persisted);

    const runs = await loadSubagentRegistryFromDisk();
    const entry = runs.get("run-legacy");
    expect(entry?.cleanupHandled).toBe(true);
    expect(entry?.cleanupCompletedAt).toBe(9);
    expect(entry?.requesterOrigin?.channel).toBe("whatsapp");
    expect(entry?.requesterOrigin?.accountId).toBe("legacy-account");

    const after = JSON.parse(await fs.readFile(registryPath, "utf8")) as { version?: number };
    expect(after.version).toBe(2);
  });

  it("retries cleanup announce after a failed announce", async () => {
    const persisted = createPersistedEndedRun({
      runId: "run-3",
      childSessionKey: "agent:main:subagent:three",
      task: "retry announce",
      cleanup: "keep",
    });
    const registryPath = await writePersistedRegistry(persisted);

    announceSpy.mockResolvedValueOnce(false);
    await restartRegistryAndFlush();

    expect(announceSpy).toHaveBeenCalledTimes(1);
    await expectPersistedRuns<{ cleanupHandled?: boolean; cleanupCompletedAt?: number }>(
      registryPath,
      (runs) => {
        expect(runs?.["run-3"]?.cleanupHandled).toBe(false);
        expect(runs?.["run-3"]?.cleanupCompletedAt).toBeUndefined();
      },
    );

    announceSpy.mockResolvedValueOnce(true);
    await restartRegistryAndFlush();

    expect(announceSpy).toHaveBeenCalledTimes(2);
    await expectPersistedRuns<{ cleanupCompletedAt?: number }>(registryPath, (runs) => {
      expect(runs?.["run-3"]?.cleanupCompletedAt).toBeDefined();
    });
  });

  it("keeps delete-mode runs retryable when announce is deferred", async () => {
    const persisted = createPersistedEndedRun({
      runId: "run-4",
      childSessionKey: "agent:main:subagent:four",
      task: "deferred announce",
      cleanup: "delete",
    });
    const registryPath = await writePersistedRegistry(persisted);

    announceSpy.mockResolvedValueOnce(false);
    await restartRegistryAndFlush();

    expect(announceSpy).toHaveBeenCalledTimes(1);
    await expectPersistedRuns<{ cleanupHandled?: boolean }>(registryPath, (runs) => {
      expect(runs?.["run-4"]?.cleanupHandled).toBe(false);
    });

    announceSpy.mockResolvedValueOnce(true);
    await restartRegistryAndFlush();

    expect(announceSpy).toHaveBeenCalledTimes(2);
    await expectPersistedRuns<unknown>(registryPath, (runs) => {
      expect(runs?.["run-4"]).toBeUndefined();
    });
  });

  it("uses isolated temp state when BUILDERFORCE_AGENTS_STATE_DIR is unset in tests", async () => {
    delete process.env.BUILDERFORCE_AGENTS_STATE_DIR;
    vi.resetModules();
    const { resolveSubagentRegistryPath } = await import("./subagent-registry.store.js");
    const registryPath = resolveSubagentRegistryPath();
    expect(registryPath).toContain(path.join(os.tmpdir(), "builderforce-test-state"));
  });
});
