/** The synced change-set and lifecycle events name the repository without credentials or a local path. */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";

const TOKEN_REMOTE = "https://x-access-token:ghp_secret123@github.com/org/repo.git";
const git = vi.hoisted(() => ({ repos: [] as Array<{ root: string; files: string[] }> }));

vi.mock("vscode", () => ({ workspace: { workspaceFolders: [] }, l10n: { t: (m: string) => m } }));

vi.mock("./gitChanges", () => ({
  refreshPendingChanges: () => undefined,
  detectPendingChanges: async () => ({
    total: git.repos.reduce((n, r) => n + r.files.length, 0),
    repos: git.repos.map(({ root, files }) => ({
      root, name: "repo", branch: "main",
      changes: files.map((rel) => ({ path: path.join(root, rel), relativePath: rel, repoRoot: root, status: "untracked", staged: false })),
    })),
  }),
}));

vi.mock("@builderforce/agent-tools/node-git-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@builderforce/agent-tools/node-git-history")>()),
  runGit: async (_cwd: string, args: string[]) => {
    if (args.includes("remote.origin.url")) return { stdout: TOKEN_REMOTE };
    if (args[0] === "rev-parse") return { stdout: "a".repeat(40) };
    return { failure: "error" };
  },
}));

import { recordChangeSetBaseline, recordChangeSetFinalization } from "./changeSetLifecycle";
import { finalizeRunChangeSets, type LocalChangeSetValue } from "./runChangeSets";

const dirs: string[] = [];
afterEach(async () => {
  git.repos = [];
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe("synced repository identity", () => {
  it("regression: a change set's synced payload carries no userinfo; the stored record keeps the local identity", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bf-synced-id-"));
    dirs.push(root);
    await fs.writeFile(path.join(root, "a.ts"), "export const a = 1;\n");
    git.repos = [{ root, files: ["a.ts"] }];
    const store = createMemoryLocalFirstStore();

    const ids = await finalizeRunChangeSets(store, { deviceId: "device-1" }, {
      runId: "run-1", baseline: { capturedAt: new Date().toISOString(), repos: [] }, author: "agent:test",
    });

    expect(ids).toHaveLength(1);
    const snapshot = await store.export();
    const event = snapshot.events.find((e) => e.entityType === "change-set" && e.clientEntityId === ids[0]);
    const synced = event?.payload as LocalChangeSetValue;
    expect(synced.repository).toBe("https://github.com/org/repo.git");
    expect(JSON.stringify(event)).not.toContain("ghp_secret123");
    expect(JSON.stringify(event)).not.toContain("x-access-token");
    const stored = snapshot.records.find((r) => r.id === ids[0])?.payload as LocalChangeSetValue;
    expect(stored.repository).toBe(TOKEN_REMOTE);
  });

  it("regression: a lifecycle's synced payloads carry no userinfo and no local root", async () => {
    const root = path.join(os.tmpdir(), "bf-private-checkout");
    const baseline = {
      capturedAt: new Date().toISOString(),
      repos: [{ root, name: "repo", repository: TOKEN_REMOTE, files: {} }, { root: `${root}-2`, name: "two", repository: `${root}-2`, files: {} }],
    };
    const store = createMemoryLocalFirstStore();
    await recordChangeSetBaseline(store, { deviceId: "device-1" }, { runId: "run-2", baseline, author: "agent:test" });
    await recordChangeSetFinalization(store, { deviceId: "device-1" }, { runId: "run-2", baseline, author: "agent:test", changeSetIds: [] });

    const events = (await store.export()).events.filter((e) => e.clientEntityId === "changeset-lifecycle:run-2");
    expect(events).toHaveLength(2);
    for (const event of events) {
      const text = JSON.stringify(event.payload);
      expect(text).not.toContain("ghp_secret123");
      expect(text).not.toContain("bf-private-checkout");
      expect((event.payload as { repository: string }).repository.split("\n")).toContain("https://github.com/org/repo.git");
    }
  });
});
