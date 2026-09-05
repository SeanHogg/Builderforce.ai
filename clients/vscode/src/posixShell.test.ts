import { describe, it, expect, beforeEach } from "vitest";
import { needsPosixShell, findBash, bashCandidates, posixShellReport, posixShellStatus, resetBashCache } from "./posixShell";
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

/**
 * A GUARD WHOSE PRESENCE CANNOT BE OBSERVED IS INDISTINGUISHABLE FROM A BROKEN ONE.
 *
 * The routing above is correct, and a real run still reported the raw `cmd.exe` error
 * it exists to prevent — on a build whose version was AHEAD of the one it shipped in.
 * Two explanations fitted equally (an install older than the version it reported, or a
 * hole in the detection) and nothing available to the reporter could separate them,
 * because whether THIS machine had a POSIX shell at all was stated nowhere. So the
 * status reports itself, into both the connection diagnostics and every copied chat
 * diagnostics report.
 */
describe("posixShellStatus / posixShellReport", () => {
  it("reports no routing off Windows, where the default shell is already POSIX", () => {
    // The suite runs on the host platform; only assert the branch that platform takes.
    const status = posixShellStatus({});
    if (process.platform === "win32") {
      expect(status.routingRequired).toBe(true);
      expect(status.candidates.length).toBeGreaterThan(0);
    } else {
      expect(status.routingRequired).toBe(false);
      expect(status.shellPath).toBeNull();
      expect(posixShellReport({})).toContain("not routed");
    }
  });

  it("names the shell it found, or every path it probed when it found none", () => {
    const report = posixShellReport({});
    if (process.platform !== "win32") return; // covered above
    if (findBash({})) {
      expect(report).toContain("routed to");
      expect(report).toContain("git_sync_latest");
    } else {
      expect(report).toContain("NO POSIX SHELL FOUND");
      // The probe list is the actionable part: a machine with bash somewhere else is
      // otherwise told only that it has none.
      for (const candidate of bashCandidates({})) expect(report).toContain(candidate);
    }
  });

  it("carries the tool names, so a report of one failing is matched to this line", () => {
    const report = posixShellReport({});
    if (process.platform === "win32") expect(report).toMatch(/git_sync_latest|POSIX/);
    else expect(report).toContain("POSIX scripts");
  });
});
