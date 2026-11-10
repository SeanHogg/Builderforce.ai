import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({ workspace: { workspaceFolders: [] }, l10n: { t: (m: string) => m } }));
vi.mock("../gitChanges", () => ({ refreshPendingChanges: () => undefined, detectPendingChanges: async () => ({ repos: [] }) }));
vi.mock("../gitApi", () => ({ getGitApi: async () => undefined, watchGitRepositories: () => ({ dispose() {} }), runGit: async () => undefined }));
const calls = vi.hoisted(() => [] as string[][]);
/** What `git log` answers (default: nothing). */
const logOut = vi.hoisted(() => ({ text: "" }));
vi.mock("@builderforce/agent-tools/node-git-history", () => ({
  runGit: async (_cwd: string, args: string[]) => { calls.push(args); return { stdout: args[0] === "log" ? logOut.text : "" }; },
}));

import { laterHistory } from "./outcomeGit";

describe("laterHistory's capped read (coveredUntil)", () => {
  it("never claims time it did not read: an out-of-order OLDER unprocessed commit stays outside coveredUntil", async () => {
    const commit = (sha: string, at: string): string => [
      `\u001e${sha.repeat(40)}\u001f${at}\u001f${"p".repeat(40)}\u001ffix: ${sha}\u001e`,
      "diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1 @@", "-x", "+y",
    ].join("\n");
    // As git prints it (newest first by its walk), with B's clock OLDER than C's although B comes after C oldest-first.
    logOut.text = [commit("a", "2026-11-03T10:00:00.000Z"), commit("b", "2026-11-03T08:00:00.000Z"), commit("c", "2026-11-03T09:00:00.000Z")].join("\n");
    const read = await laterHistory("/repo", "2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", new Set(["src/a.ts"]), 1);
    logOut.text = "";
    expect(read?.complete).toBe(false);
    expect(read?.history.map((c) => c.sha)).toEqual(["c".repeat(40)]);
    // The last processed commit (C, 09:00) would have claimed 08:00–09:00, which includes B: it must not.
    expect(read?.coveredUntil).toBe("2026-11-03T07:59:59.999Z");
    expect(Date.parse(read!.coveredUntil)).toBeLessThan(Date.parse("2026-11-03T08:00:00.000Z"));
  });
});

describe("laterHistory's git arguments (M-B)", () => {
  it("reads side-branch commits: no --first-parent, path-limited, merges' parents in the format", async () => {
    const read = await laterHistory("/repo", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z", new Set(["src/a.ts"]));
    expect(read).toEqual({ history: [], complete: true, coveredUntil: "2026-12-01T00:00:00Z" });
    const log = calls.find((args) => args[0] === "log")!;
    expect(log).not.toContain("--first-parent");
    expect(log).toContain("-p");
    expect(log.slice(log.indexOf("--"))).toEqual(["--", "src/a.ts"]);
    expect(log.find((a) => a.startsWith("--format="))).toContain("%P");
  });
});
