import { execFileSync } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitRepo, mapLimit } from "./gitBranchFacts";

/** A real repository, so the plumbing (rev-list, merge-tree) is exercised, not mocked. */
describe("GitRepo", () => {
  let dir: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "bf-gitfacts-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    await writeFile(join(dir, "a.txt"), "one\n");
    git("add", ".");
    git("commit", "-qm", "base");

    git("checkout", "-qb", "feature/clean");
    await writeFile(join(dir, "b.txt"), "new file\n");
    git("add", ".");
    git("commit", "-qm", "clean change");

    git("checkout", "-q", "main");
    git("checkout", "-qb", "feature/conflict");
    await writeFile(join(dir, "a.txt"), "branch side\n");
    git("commit", "-qam", "conflicting change");

    git("checkout", "-q", "main");
    git("checkout", "-qb", "feature/merged");
    await writeFile(join(dir, "c.txt"), "merged\n");
    git("add", ".");
    git("commit", "-qm", "to be merged");

    git("checkout", "-q", "main");
    await writeFile(join(dir, "a.txt"), "main side\n");
    git("commit", "-qam", "main moves on");
    git("merge", "-q", "--no-ff", "-m", "merge", "feature/merged");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("knows a repository, and resolves the base without a remote", async () => {
    const repo = new GitRepo(dir);
    expect(await repo.isRepo()).toBe(true);
    expect(await repo.resolveBase()).toBe("main");
    expect(await new GitRepo(tmpdir()).isRepo()).toBe(false);
  });

  it("lists branches with their refs", async () => {
    const names = (await new GitRepo(dir).branches()).map((b) => b.name).sort();
    expect(names).toEqual(["feature/clean", "feature/conflict", "feature/merged", "main"]);
  });

  it("reports ahead/behind and a no-checkout merge verdict", async () => {
    const repo = new GitRepo(dir);
    const clean = await repo.compare("main", "refs/heads/feature/clean");
    expect(clean).toMatchObject({ ahead: 1, merge: "clean" });
    expect(clean.behind).toBeGreaterThan(0);
    const conflict = await repo.compare("main", "refs/heads/feature/conflict");
    expect(conflict.merge).toBe("conflicts");
    expect(conflict.conflictFiles).toEqual(["a.txt"]);
    expect(await repo.compare("main", "refs/heads/feature/merged")).toMatchObject({ ahead: 0, merge: "in_base" });
    // The working tree was never touched by the merge checks.
    expect(git("status", "--porcelain")).toBe("");
  });
});

describe("mapLimit", () => {
  it("keeps order and never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});
