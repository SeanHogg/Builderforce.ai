import { describe, expect, it } from "vitest";
import { detectBranchSwitch } from "./branch-switch.js";

describe("detectBranchSwitch — commands that switch a checkout's branch", () => {
  it.each([
    ["git checkout main", { target: "main", creates: false }],
    ["git checkout -", { target: "-", creates: false }],
    ["git checkout -b feature/x", { target: "feature/x", creates: true }],
    ["git checkout -B feature/x origin/main", { target: "feature/x", creates: true }],
    ["git checkout --orphan fresh", { target: "fresh", creates: true }],
    ["git checkout --detach", { creates: false }],
    ["git checkout --detach v1.2.0", { target: "v1.2.0", creates: false }],
    ["git checkout -t origin/feature", { target: "origin/feature", creates: false }],
    ["git switch main", { target: "main", creates: false }],
    ["git switch -c feature/x", { target: "feature/x", creates: true }],
    ["git switch -C feature/x main", { target: "feature/x", creates: true }],
    ["git switch --create feature/x", { target: "feature/x", creates: true }],
    ["git switch --create=feature/x", { target: "feature/x", creates: true }],
    ["git switch --detach", { creates: false }],
    ["git switch -d HEAD~1", { target: "HEAD~1", creates: false }],
    ["git -c core.hooksPath=/dev/null checkout main", { target: "main", creates: false }],
    ["git --no-pager switch dev", { target: "dev", creates: false }],
  ])("%s", (command, expected) => {
    expect(detectBranchSwitch(command)).toEqual(expected);
  });

  it("keeps `git -C <dir>`'s directory, so the status check runs in that checkout", () => {
    expect(detectBranchSwitch("git -C repos/api checkout -b fix")).toEqual({ target: "fix", creates: true, dir: "repos/api" });
  });

  it.each([
    ["cd sub && git checkout main", { target: "main", creates: false, dir: "sub" }],
    ["pushd sub/ && git switch dev", { target: "dev", creates: false, dir: "sub" }],
    ["cd a && cd b; git switch dev", { target: "dev", creates: false, dir: "a/b" }],
    ["cd sub && git -C inner switch x", { target: "x", creates: false, dir: "sub/inner" }],
    ["cd sub && git -C /abs/repo switch x", { target: "x", creates: false, dir: "/abs/repo" }],
    ["cd /abs/repo && git checkout main", { target: "main", creates: false, dir: "/abs/repo" }],
  ])("carries a preceding cd into the directory: %s", (command, expected) => {
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
    "git checkout",
    "git switch",
    "git restore src/a.ts",
    "git restore --source main src/a.ts",
    "git status",
    "git log --oneline checkout",
    "echo git checkout main",
    "npm run checkout",
    "grep -r 'git checkout main' docs",
    "",
    "git checkout 'unbalanced",
  ])("%s", (command) => {
    expect(detectBranchSwitch(command)).toBeUndefined();
  });
});
