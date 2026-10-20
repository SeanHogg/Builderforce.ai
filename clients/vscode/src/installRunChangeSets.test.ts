import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import type { RunChangeBaseline } from "./runChangeSets";

const git = vi.hoisted(() => ({
  detect: vi.fn(async () => ({ total: 0, repos: [] })),
  refresh: vi.fn(),
  runGit: vi.fn(async (_cwd: string, _args: string) => ""),
}));

vi.mock("./gitChanges", () => ({
  detectPendingChanges: () => git.detect(),
  refreshPendingChanges: () => git.refresh(),
}));

vi.mock("./gitApi", () => ({
  runGit: (cwd: string, args: string) => git.runGit(cwd, args),
}));

vi.mock("vscode", () => ({
  workspace: { workspaceFolders: [] },
  l10n: { t: (message: string) => message },
}));

vi.mock("./localFirstStore", () => ({
  localBrainApplication: () => {
    throw new Error("installer test must not open the production store");
  },
}));

import { isFinishedChangeSet, isPartialChangeSet } from "./runChangeSets";
import {
  RUN_HOST_CHANGE_SET_LINE,
  installRunChangeSets,
  type RunChangeSetHostContext,
} from "./installRunChangeSets";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date("2026-10-18T12:00:00.000Z");
const LATER = new Date("2026-10-18T13:00:00.000Z");

function hostContext(): RunChangeSetHostContext {
  return {
    globalState: {
      get: () => undefined,
      update: async () => undefined,
    },
  };
}

function baseline(): RunChangeBaseline {
  return { capturedAt: NOW.toISOString(), repos: [] };
}

describe("installRunChangeSets", () => {
  it("treats a baseline with no finalization as partial, including after a restart", async () => {
    const store = createMemoryLocalFirstStore();
    const ports = { store, deviceId: "device-1", now: () => NOW };
    const opened = await installRunChangeSets(hostContext(), ports).recordBaseline({
      runId: "run-partial",
      baseline: baseline(),
      author: "agent:brain-host",
    });

    expect(isPartialChangeSet(opened)).toBe(true);
    expect(isFinishedChangeSet(opened)).toBe(false);
    expect(opened.baselineHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(opened.finalizedAt).toBeUndefined();

    const restarted = installRunChangeSets(hostContext(), ports);
    expect(await restarted.readPhase("run-partial")).toBe("partial");
    expect(await restarted.readPhase("run-never-opened")).toBe("absent");
  });

  it("treats a recorded finalization as finished, and does not rewrite the close", async () => {
    const store = createMemoryLocalFirstStore();
    const ports = { store, deviceId: "device-1", now: () => NOW };
    const first = installRunChangeSets(hostContext(), ports);
    await first.recordBaseline({
      runId: "run-finished",
      baseline: baseline(),
      author: "agent:brain-host",
    });
    expect(await first.readPhase("run-finished")).toBe("partial");

    const closed = await installRunChangeSets(hostContext(), { ...ports, now: () => LATER }).recordFinalization({
      runId: "run-finished",
      baseline: baseline(),
      author: "agent:brain-host",
      changeSetIds: ["changeset:run-finished:b", "changeset:run-finished:a"],
    });
    expect(isFinishedChangeSet(closed)).toBe(true);
    expect(isPartialChangeSet(closed)).toBe(false);
    expect(closed.finalizedAt).toBe(LATER.toISOString());
    expect(closed.changeSetIds).toEqual(["changeset:run-finished:a", "changeset:run-finished:b"]);
    expect(closed.finalizationHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const again = await installRunChangeSets(hostContext(), {
      store,
      deviceId: "device-1",
      now: () => new Date("2026-10-19T00:00:00.000Z"),
    }).recordFinalization({
      runId: "run-finished",
      baseline: baseline(),
      author: "someone-else",
      changeSetIds: ["other"],
    });
    expect(again.finalizedAt).toBe(LATER.toISOString());
    expect(again.author).toBe("agent:brain-host");
    expect(again.changeSetIds).toEqual(["changeset:run-finished:a", "changeset:run-finished:b"]);
    expect(await installRunChangeSets(hostContext(), ports).readPhase("run-finished")).toBe("finished");
  });

  it("records a baseline before the host start and a finalization after, with no fetch", async () => {
    const store = createMemoryLocalFirstStore();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const installed = installRunChangeSets(hostContext(), {
      store,
      deviceId: "device-1",
      now: () => NOW,
    });

    const settled = await installed.aroundRun({ runId: "run-around", author: "agent:brain-host" }, async () => {
      expect(await installed.readPhase("run-around")).toBe("partial");
      return "settled";
    });

    expect(settled).toBe("settled");
    expect(await installed.readPhase("run-around")).toBe("finished");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not open a set when the start does not own the turn", async () => {
    git.detect.mockClear();
    const store = createMemoryLocalFirstStore();
    const installed = installRunChangeSets(hostContext(), { store, deviceId: "device-1", now: () => NOW });
    await expect(
      installed.aroundRun({ runId: "run-busy", author: "agent:brain-host", stillRunning: () => true }, async () => "skipped"),
    ).resolves.toBe("skipped");
    expect(await installed.readPhase("run-busy")).toBe("absent");
    expect(git.detect).not.toHaveBeenCalled();
  });

  it("is not called from the run host, and does not import the editor or fetch", () => {
    const extension = readFileSync(resolve(here, "extension.ts"), "utf8");
    const host = readFileSync(resolve(here, "brainRunHostPorts.ts"), "utf8");
    expect(extension).not.toContain("installRunChangeSets");
    expect(host).not.toContain("installRunChangeSets");
    expect(host).not.toContain(RUN_HOST_CHANGE_SET_LINE);
    expect(extension).not.toContain(RUN_HOST_CHANGE_SET_LINE);

    const source = readFileSync(resolve(here, "installRunChangeSets.ts"), "utf8");
    expect(source).not.toMatch(/from ["']vscode["']/);
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("applyPatch");
    expect(source).toContain("recordChangeSetBaseline");
    expect(source).toContain("recordChangeSetFinalization");
  });
});
