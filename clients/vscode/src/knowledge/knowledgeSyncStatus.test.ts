import { describe, expect, it } from "vitest";
import type { KnowledgeFs } from "@builderforce/agent-tools/knowledge";
import { buildSyncStatus } from "./knowledgeSyncStatus";

/** A file system holding only these absolute paths. */
function fsWith(...present: string[]): KnowledgeFs {
  const text = new TextEncoder().encode("");
  return {
    readDirectory: async (path) => {
      const names = new Set(present.filter((p) => p.startsWith(`${path}/`)).map((p) => p.slice(path.length + 1).split("/")[0]!));
      return [...names].map((name) => [name, present.includes(`${path}/${name}`) ? "file" : "dir"] as [string, "file" | "dir"]);
    },
    stat: async (path) => {
      if (!present.some((p) => p === path || p.startsWith(`${path}/`))) throw new Error("ENOENT");
      return { mtime: 1, size: 0 };
    },
    readFile: async () => text,
  };
}

const base = { rootPath: "/repo", local: { files: 5, docs: 2 }, hasHistory: true };

describe("buildSyncStatus", () => {
  it("states every source from what is present, and never a number for one that is not set up", async () => {
    const status = await buildSyncStatus({
      ...base, fs: fsWith("/repo/.github/CODEOWNERS", "/repo/docs/openapi.yaml"), skipped: [], reviewed: true,
    });
    const state = Object.fromEntries(status.sources.map((s) => [s.id, s.state]));
    expect(state).toEqual({
      code: "collected", docs: "collected", coverage: "absent", usage: "absent", traces: "absent",
      openapi: "collected", history: "collected", owners: "collected",
    });
  });

  it("says code and docs are absent for a root that was never reviewed", async () => {
    const status = await buildSyncStatus({ ...base, fs: fsWith(), skipped: undefined, reviewed: false, hasHistory: false });
    expect(status.sources.filter((s) => s.id === "code" || s.id === "docs").map((s) => s.state)).toEqual(["absent", "absent"]);
    expect(status.sources.find((s) => s.id === "history")?.state).toBe("absent");
  });

  it("leaves skipped out when no review recorded a list (unknown), and keeps an empty list (none)", async () => {
    const unknown = await buildSyncStatus({ ...base, fs: fsWith(), skipped: undefined, reviewed: true });
    expect(unknown).not.toHaveProperty("skipped");
    const none = await buildSyncStatus({ ...base, fs: fsWith(), skipped: [], reviewed: true });
    expect(none.skipped).toEqual([]);
  });

  it("carries the platform's counts beside the local ones, and notes skipped coverage files", async () => {
    const status = await buildSyncStatus({
      ...base, fs: fsWith(), reviewed: true,
      server: { files: 9, docs: 4, edges: 30, truncated: true },
      skipped: [{ path: "coverage/lcov.info", reason: "coverage-stale" }, { path: "a.png", bytes: 3, reason: "binary" }],
    });
    expect(status.server).toEqual({ files: 9, docs: 4, edges: 30, truncated: true });
    expect(status.local).toEqual({ files: 5, docs: 2 });
    expect(status.sources.find((s) => s.id === "coverage")?.note).toMatch(/1 coverage file/);
    expect(status.skipped).toHaveLength(2);
  });
});
