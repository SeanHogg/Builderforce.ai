import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseGitPorcelain, taskWorkspaceDir, buildTaskCloneUrl, taskBranchName, sweepStaleTaskWorkspaces } from "./task-workspace.js";

describe("task-workspace pure helpers", () => {
  it("builds a stable per-task workspace dir", () => {
    expect(taskWorkspaceDir("/work", 23).replace(/\\/g, "/")).toBe("/work/.builderforce/tasks/23");
  });

  it("builds the git-proxy clone url (trims trailing slash)", () => {
    expect(buildTaskCloneUrl("https://api.builderforce.ai/", "12", "repo-abc")).toBe(
      "https://api.builderforce.ai/api/agent-hosts/12/git-proxy/repo-abc",
    );
  });

  it("builds a deterministic branch name", () => {
    expect(taskBranchName(23)).toBe("builderforce/task-23");
  });
});

describe("parseGitPorcelain", () => {
  it("maps untracked + added to created, attributed to the agent", () => {
    const out = parseGitPorcelain("?? src/new.ts\nA  src/added.ts", "Audit Agent");
    expect(out).toEqual([
      { path: "src/new.ts", change: "created", agent: "Audit Agent" },
      { path: "src/added.ts", change: "created", agent: "Audit Agent" },
    ]);
  });

  it("maps modified and deleted", () => {
    const out = parseGitPorcelain(" M src/a.ts\n D src/b.ts\nD  src/c.ts", "X");
    expect(out.map((c) => [c.path, c.change])).toEqual([
      ["src/a.ts", "modified"],
      ["src/b.ts", "deleted"],
      ["src/c.ts", "deleted"],
    ]);
  });

  it("attributes the new path on a rename", () => {
    const out = parseGitPorcelain("R  old/path.ts -> new/path.ts", "Y");
    expect(out).toEqual([{ path: "new/path.ts", change: "modified", agent: "Y" }]);
  });

  it("strips surrounding quotes from paths with spaces", () => {
    const out = parseGitPorcelain('?? "src/a b.ts"', "Z");
    expect(out[0].path).toBe("src/a b.ts");
  });

  it("ignores blank / too-short lines", () => {
    expect(parseGitPorcelain("\n\n x\n?? real.ts", "A")).toEqual([
      { path: "real.ts", change: "created", agent: "A" },
    ]);
  });
});

describe("sweepStaleTaskWorkspaces", () => {
  async function mkTasks(base: string, ids: number[]): Promise<void> {
    for (const id of ids) await fs.mkdir(taskWorkspaceDir(base, id), { recursive: true });
  }

  it("removes task dirs older than maxAge, keeps fresh ones", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "bf-sweep-"));
    try {
      await mkTasks(base, [1, 2]);
      // Age task 1 well past the cutoff; leave task 2 fresh.
      const old = new Date(Date.now() - 48 * 3_600_000);
      await fs.utimes(taskWorkspaceDir(base, 1), old, old);

      const { removed } = await sweepStaleTaskWorkspaces(base, { maxAgeMs: 24 * 3_600_000 });

      expect(removed.map((d) => d.replace(/\\/g, "/"))).toEqual([
        taskWorkspaceDir(base, 1).replace(/\\/g, "/"),
      ]);
      await expect(fs.stat(taskWorkspaceDir(base, 2))).resolves.toBeDefined();
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("never removes an active task dir even when stale", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "bf-sweep-"));
    try {
      await mkTasks(base, [5]);
      const old = new Date(Date.now() - 48 * 3_600_000);
      await fs.utimes(taskWorkspaceDir(base, 5), old, old);

      const { removed } = await sweepStaleTaskWorkspaces(base, { maxAgeMs: 24 * 3_600_000, activeTaskIds: [5] });

      expect(removed).toEqual([]);
      await expect(fs.stat(taskWorkspaceDir(base, 5))).resolves.toBeDefined();
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("returns empty when there is no tasks dir", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "bf-sweep-"));
    try {
      expect(await sweepStaleTaskWorkspaces(base)).toEqual({ removed: [] });
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});
