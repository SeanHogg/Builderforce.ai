import { describe, it, expect, beforeEach } from "vitest";
import { needsPosixShell, findBash, bashCandidates, resetBashCache } from "./posixShell";
import { buildGitCommand } from "@builderforce/agent-tools";

beforeEach(resetBashCache);

describe("needsPosixShell", () => {
  it("recognizes every git tool that is actually a POSIX script", () => {
    // These three were dead on Windows: cmd.exe parses `set -e` as its own builtin
    // and answers "Environment variable -e not defined", which a real run reported.
    for (const action of ["sync_latest", "undo", "redo"] as const) {
      expect(needsPosixShell(buildGitCommand(action))).toBe(true);
    }
  });

  it("leaves the plain one-liner git tools in the default shell", () => {
    for (const action of ["status", "diff", "history"] as const) {
      expect(needsPosixShell(buildGitCommand(action))).toBe(false);
    }
  });

  it("does not misroute ordinary commands", () => {
    // A forward-slash path or an && chain is not a POSIX-only construct; routing
    // these through bash would change behaviour for commands that already work.
    for (const cmd of [
      "npm test",
      "cd Builderforce.ai/frontend && git add -A && git commit -m \"x\" && git push",
      "git status --short --branch",
      "npx tsc --noEmit",
    ]) expect(needsPosixShell(cmd)).toBe(false);
  });

  it("recognizes the constructs directly", () => {
    expect(needsPosixShell('set -e\ngit fetch')).toBe(true);
    expect(needsPosixShell('BASE="$(git remote show origin)"')).toBe(true);
    expect(needsPosixShell('[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }')).toBe(true);
    expect(needsPosixShell('export FOO=1')).toBe(true);
  });
});

describe("findBash", () => {
  const NONE = () => false;

  it("returns null rather than guessing when nothing is installed", () => {
    // The caller degrades to an explicit, actionable error on null; a wrong path
    // here would instead produce an ENOENT the agent could not interpret.
    expect(findBash({} as NodeJS.ProcessEnv, NONE)).toBeNull();
  });

  it("prefers Git for Windows' own bash over the generic paths", () => {
    const env = { ProgramFiles: "C:\\PF" } as NodeJS.ProcessEnv;
    expect(findBash(env, (p) => p.includes("Git"))).toBe("C:\\PF\\Git\\bin\\bash.exe");
  });

  it("caches the lookup — the shell capability runs once per tool step", () => {
    const first = findBash({} as NodeJS.ProcessEnv, NONE);
    // Without the cache this second call would resolve to a path instead of null.
    expect(findBash({} as NodeJS.ProcessEnv, () => true)).toBe(first);
  });
});

describe("bashCandidates", () => {
  it("looks beside git before falling back to absolute paths", () => {
    const list = bashCandidates({ ProgramFiles: "C:\\PF" } as NodeJS.ProcessEnv);
    expect(list[0]).toContain("Git");
    expect(list).toContain("/bin/bash");
  });
});
