/**
 * The run's default checkout in a folder that CONTAINS checkouts (PRD 35 E3): gathered
 * cheapest-first, decided by the shared resolver, never failing the run.
 */

import { describe, expect, it, vi } from "vitest";
import { resolveRunDefaultRepo, type DefaultRepoPorts } from "./runDefaultRepo";

const ORIGINS: Record<string, string> = {
  "/code/Builderforce.ai": "git@github.com:seanhogg/Builderforce.ai.git",
  "/code/builderforce-memory": "https://github.com/seanhogg/builderforce-memory.git",
};

function ports(over: Partial<DefaultRepoPorts> = {}): DefaultRepoPorts {
  return {
    root: "/code",
    isCheckout: async () => false,
    listCheckouts: async () => ["Builderforce.ai", "builderforce-memory"],
    originUrl: async (dir) => ORIGINS[dir.split("\\").join("/")],
    parseRemote: (url) => {
      const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url);
      return m ? { owner: m[1]!, repo: m[2]! } : null;
    },
    projectRepos: async () => [{ owner: "seanhogg", repo: "builderforce-memory", isDefault: true }],
    ...over,
  };
}

describe("resolveRunDefaultRepo", () => {
  it("is undefined when the root is itself a repository", async () => {
    expect(await resolveRunDefaultRepo(ports({ isCheckout: async () => true }), { projectId: 1 })).toBeUndefined();
  });

  it("takes the only checkout without asking the platform", async () => {
    const projectRepos = vi.fn(async () => []);
    expect(await resolveRunDefaultRepo(ports({ listCheckouts: async () => ["app"], projectRepos }), { projectId: 1 })).toBe("app");
    expect(projectRepos).not.toHaveBeenCalled();
  });

  it("takes the checkout a path in the request names, before the project's repo", async () => {
    const projectRepos = vi.fn(async () => [{ owner: "seanhogg", repo: "builderforce-memory" }]);
    const repo = await resolveRunDefaultRepo(ports({ projectRepos }), { projectId: 1, request: "update Builderforce.ai/docs/specs/35-prd.md" });
    expect(repo).toBe("Builderforce.ai");
    expect(projectRepos).not.toHaveBeenCalled();
  });

  it("matches the project's repository to a checkout's origin", async () => {
    expect(await resolveRunDefaultRepo(ports(), { projectId: 1, request: "fix the recall bug" })).toBe("builderforce-memory");
  });

  it("is undefined with several checkouts and nothing to decide between them", async () => {
    expect(await resolveRunDefaultRepo(ports(), { request: "fix the recall bug" })).toBeUndefined();
  });

  it("falls back to undefined when a read fails or hangs, never throwing into the run", async () => {
    expect(await resolveRunDefaultRepo(ports({ listCheckouts: async () => { throw new Error("EACCES"); } }), { projectId: 1 })).toBeUndefined();
    const hung = ports({ projectRepos: () => new Promise(() => undefined), timeoutMs: 50 });
    expect(await resolveRunDefaultRepo(hung, { projectId: 1 })).toBeUndefined();
  });
});
