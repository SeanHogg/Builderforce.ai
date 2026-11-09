/**
 * The result cache (chat #60338: a 100-second type-check re-run only to grep its output): an
 * unchanged verification command answers from cache, and anything that changes the checkout — or a
 * command that may write — makes the next one run for real. A read-only command leaves it alone.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalShell } from "./localShell";
import { isCacheableCommand, shellCacheEffect } from "./localShellCache";
import { killRunJobs } from "./localShellJobs";

describe("shellCacheEffect", () => {
  it("caches verification, keeps the cache across a read-only command, drops it on anything that may write", () => {
    expect(shellCacheEffect("pnpm type-check")).toBe("cache");
    for (const c of ["git status", "git log --oneline -5", "ls src", "cat package.json", "grep -rn foo src"]) {
      expect(shellCacheEffect(c), c).toBe("keep");
    }
    for (const c of ["pnpm install", "git commit -m x", "echo x > f.txt", "node build.js"]) {
      expect(shellCacheEffect(c), c).toBe("drop");
    }
  });
});

describe("isCacheableCommand", () => {
  it("caches verification commands, not cheap reads", () => {
    for (const c of ["pnpm type-check", "pnpm --filter api typecheck", "npm test", "npm run lint", "pnpm test:unit 2>&1", "npx tsc --noEmit -p .", "vitest run src/a.test.ts"]) {
      expect(isCacheableCommand(c), c).toBe(true);
    }
    for (const c of ["git status", "git log --oneline -5", "ls src", "cat package.json", "grep -rn foo src"]) {
      expect(isCacheableCommand(c), c).toBe(false);
    }
  });

  it("never caches installs, writes, git mutations, fixers or clock/network reads", () => {
    for (const c of ["pnpm install", "npm i", "pnpm add x", "git commit -m x", "git checkout main", "git pull", "eslint --fix src", "vitest run -u", "tsc -p .", "echo x > f.txt", "rm -rf dist", "npm test && git push", "date", "git ls-remote origin", "node build.js"]) {
      expect(isCacheableCommand(c), c).toBe(false);
    }
  });
});

let repo = "";
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

beforeAll(() => {
  if (!hasGit) return;
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "bf-shell-cache-"));
  const git = (...args: string[]): void => void execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  // A verification script (cacheable) whose output reads the checkout.
  const script = `node -e "process.stdout.write(require('fs').readFileSync('a.txt','utf8'))"`;
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "bf-shell-cache", private: true, scripts: { test: script } }));
  git("add", ".");
  git("commit", "-q", "-m", "init");
});

afterAll(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
});

describe.skipIf(!hasGit)("an unchanged verification command answers from cache", () => {
  const CHECK = "npm test";

  it("the repeat is cached, says since when, and fresh:true runs it again", async () => {
    const shell = createLocalShell(repo, { jobOwner: 7201 });
    const first = await shell.run(CHECK);
    expect(first.cached).toBeUndefined();
    const again = await shell.run(CHECK);
    expect(again.cached).toBe(true);
    expect(again.note).toMatch(/^no files changed since \d{4}-\d\d-\d\dT.*; re-run with fresh:true to force$/);
    expect(again.stdout).toBe(first.stdout);
    expect((await shell.run(CHECK, { fresh: true })).cached).toBeUndefined();
    await killRunJobs(7201);
  }, 20_000);

  it("an edit to the checkout — by anything — makes it run for real", async () => {
    const shell = createLocalShell(repo, { jobOwner: 7202 });
    await shell.run(CHECK);
    fs.writeFileSync(path.join(repo, "a.txt"), "two\n");
    const after = await shell.run(CHECK);
    expect(after.cached).toBeUndefined();
    expect(after.stdout).toContain("two");
    fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
    await killRunJobs(7202);
  }, 20_000);

  it("a command that may write drops the run's cache", async () => {
    const shell = createLocalShell(repo, { jobOwner: 7203 });
    await shell.run(CHECK);
    await shell.run('node -e "1"');
    expect((await shell.run(CHECK)).cached).toBeUndefined();
    await killRunJobs(7203);
  }, 20_000);

  it("a read-only command does not drop a cached verification result", async () => {
    const shell = createLocalShell(repo, { jobOwner: 7206 });
    await shell.run(CHECK);
    await shell.run("git status --porcelain");
    expect((await shell.run(CHECK)).cached).toBe(true);
    await killRunJobs(7206);
  }, 20_000);

  it("is per run, and a shell with no run (a hook) never caches", async () => {
    const a = createLocalShell(repo, { jobOwner: 7204 });
    const b = createLocalShell(repo, { jobOwner: 7205 });
    await a.run(CHECK);
    expect((await b.run(CHECK)).cached).toBeUndefined();
    const hook = createLocalShell(repo);
    await hook.run(CHECK);
    expect((await hook.run(CHECK)).cached).toBeUndefined();
    await killRunJobs(7204);
    await killRunJobs(7205);
  }, 20_000);
});
