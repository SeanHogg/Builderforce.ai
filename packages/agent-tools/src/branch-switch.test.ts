import { describe, expect, it } from "vitest";
import { detectBranchSwitch } from "./branch-switch.js";

describe("detectBranchSwitch — commands that switch a checkout's branch", () => {
  it.each([
    ["git checkout main", { target: "main", creates: false, ambiguous: true }],
    ["git checkout -", { target: "-", creates: false }],
    ["git checkout main --", { target: "main", creates: false }],
    ["git checkout -b feature/x", { target: "feature/x", creates: true }],
    ["git checkout -bfeat", { target: "feat", creates: true }],
    ["git checkout -B feature/x origin/main", { target: "feature/x", creates: true }],
    ["git checkout --orphan fresh", { target: "fresh", creates: true }],
    ["git checkout --detach", { creates: false }],
    ["git checkout --detach v1.2.0", { target: "v1.2.0", creates: false }],
    ["git checkout -t origin/feature", { target: "origin/feature", creates: false, ambiguous: true }],
    ["git switch main", { target: "main", creates: false }],
    ["git switch -c feature/x", { target: "feature/x", creates: true }],
    ["git switch -cfeat", { target: "feat", creates: true }],
    ["git switch -C feature/x main", { target: "feature/x", creates: true }],
    ["git switch --create feature/x", { target: "feature/x", creates: true }],
    ["git switch --create=feature/x", { target: "feature/x", creates: true }],
    ["git switch --detach", { creates: false }],
    ["git switch -d HEAD~1", { target: "HEAD~1", creates: false }],
    ["git -c core.hooksPath=/dev/null checkout main", { target: "main", creates: false, ambiguous: true }],
    ["git --no-pager switch dev", { target: "dev", creates: false }],
    ["git --git-dir /x/.git --work-tree /x switch dev", { target: "dev", creates: false }],
  ])("%s", (command, expected) => {
    expect(detectBranchSwitch(command)).toEqual(expected);
  });

  it.each([
    ["git checkout main 2>&1", { target: "main", creates: false, ambiguous: true }],
    ["git switch dev 2>&1", { target: "dev", creates: false }],
    ["git checkout main >/dev/null", { target: "main", creates: false, ambiguous: true }],
    ["git checkout main > out.txt", { target: "main", creates: false, ambiguous: true }],
    ["git switch dev 2> err.log", { target: "dev", creates: false }],
  ])("a redirect is not an argument: %s", (command, expected) => {
    expect(detectBranchSwitch(command)).toEqual(expected);
  });

  it("keeps `git -C <dir>`'s directory, so the status check runs in that checkout", () => {
    expect(detectBranchSwitch("git -C repos/api checkout -b fix")).toEqual({ target: "fix", creates: true, dir: "repos/api" });
  });

  it.each([
    ["cd sub && git checkout main", { target: "main", creates: false, ambiguous: true, dir: "sub" }],
    ["pushd sub/ && git switch dev", { target: "dev", creates: false, dir: "sub" }],
    ["cd a && cd b; git switch dev", { target: "dev", creates: false, dir: "a/b" }],
    ["cd sub && git -C inner switch x", { target: "x", creates: false, dir: "sub/inner" }],
    ["cd sub && git -C /abs/repo switch x", { target: "x", creates: false, dir: "/abs/repo" }],
    ["cd /abs/repo && git switch main", { target: "main", creates: false, dir: "/abs/repo" }],
    ["cd C:\\work\\api && git switch main", { target: "main", creates: false, dir: "C:\\work\\api" }],
  ])("carries a preceding cd into the directory: %s", (command, expected) => {
    expect(detectBranchSwitch(command)).toEqual(expected);
  });

  it.each([
    ["(git switch main)", { target: "main", creates: false }],
    ["(cd sub && git switch main)", { target: "main", creates: false, dir: "sub" }],
    ["( git checkout -b x )", { target: "x", creates: true }],
  ])("reads a subshell: %s", (command, expected) => {
    expect(detectBranchSwitch(command)).toEqual(expected);
  });

  it.each([
    ["(cd sub && make); git switch x", { target: "x", creates: false }],
    ["(cd a && (cd b && make) && make); git switch x", { target: "x", creates: false }],
    ["cd repo && (cd sub && make) && git switch x", { target: "x", creates: false, dir: "repo" }],
    ["cd repo && (git switch x)", { target: "x", creates: false, dir: "repo" }],
  ])("a cd inside a subshell ends with it: %s", (command, expected) => {
    expect(detectBranchSwitch(command)).toEqual(expected);
  });

  it.each([
    ["env GIT_TRACE=1 git switch main", { target: "main", creates: false }],
    ["env -i A=1 git switch main", { target: "main", creates: false }],
    ["command git switch main", { target: "main", creates: false }],
    ["time git switch main", { target: "main", creates: false }],
    ["nohup git switch main", { target: "main", creates: false }],
    ["timeout 30 git switch main", { target: "main", creates: false }],
    ["timeout -s KILL 30 git switch main", { target: "main", creates: false }],
    ["bash -c 'git switch main'", { target: "main", creates: false }],
    ["sh -c \"cd sub && git switch -c x\"", { target: "x", creates: true, dir: "sub" }],
    ["cd repo && bash -c 'git -C inner switch main'", { target: "main", creates: false, dir: "repo/inner" }],
    ['bash -lc "git switch feat"', { target: "feat", creates: false }],
    ["sh -ec 'git switch -c x'", { target: "x", creates: true }],
    ["bash -l -c 'git switch feat'", { target: "feat", creates: false }],
    ["bash --norc -c 'git switch feat'", { target: "feat", creates: false }],
  ])("sees through a wrapper: %s", (command, expected) => {
    expect(detectBranchSwitch(command)).toEqual(expected);
  });

  it.each([
    "git fetch && git checkout main",
    "npm test; git switch -c wip",
    "git status || git checkout main",
    "cd repo && git checkout dev && npm install",
    "if true; then git checkout main; fi",
    "GIT_TRACE=1 git checkout main",
  ])("finds the switch in a compound command: %s", (command) => {
    expect(detectBranchSwitch(command)).toBeDefined();
  });
});

describe("detectBranchSwitch — commands that do NOT switch", () => {
  it.each([
    "git checkout -- src/a.ts",
    "git checkout main -- src/a.ts",
    "git checkout HEAD~1 -- .",
    "git checkout main src/a.ts src/b.ts",
    "git checkout .",
    "git checkout -p",
    "git checkout --patch main",
    "git checkout --ours src/a.ts",
    "git checkout --theirs src/a.ts",
    "git checkout -2 src/a.ts",
    "git checkout -3 src/a.ts",
    "git checkout",
    "git switch",
    "git restore src/a.ts",
    "git restore --source main src/a.ts",
    "git status",
    "git log --oneline checkout",
    "echo git checkout main",
    "npm run checkout",
    "grep -r 'git checkout main' docs",
    "bash -c 'git status'",
    "bash script.sh",
    "bash -l script.sh",
    "",
    "git checkout 'unbalanced",
  ])("%s", (command) => {
    expect(detectBranchSwitch(command)).toBeUndefined();
  });
});
