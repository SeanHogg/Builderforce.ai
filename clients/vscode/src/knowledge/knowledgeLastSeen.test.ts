import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { LAST_SEEN_MAX_BYTES, clearLastSeen, readLastSeen, workspaceKey, writeLastSeen, type LastSeenRecord } from "./knowledgeLastSeen";

const graph = (rootId: string, label = "a.ts"): KnowledgeGraph => ({
  scope: { rootId, packs: ["code"], digest: "d" },
  nodes: [{ ref: `src:${rootId}::${label}`, kind: "file", label, pack: "code", importance: 1, origin: "extracted", sourceHash: "h" }],
  edges: [],
  findings: [],
  stats: { sources: 1, nodes: 1, edges: 0, stale: 0, truncated: false },
} as unknown as KnowledgeGraph);

const record = (rootId: string): LastSeenRecord => ({ scopes: [{ rootId, title: rootId, packs: ["code"] }], rootId, graph: graph(rootId) });

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "kg-last-seen-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("knowledgeLastSeen", () => {
  it("round-trips a record for a workspace, and leaves no temp file behind", async () => {
    const key = workspaceKey([{ path: "/w/b" }, { path: "/w/a" }]);
    expect(await writeLastSeen(dir, key, record("r1"))).toBe(true);
    expect(await readLastSeen(dir, key)).toEqual(record("r1"));
    expect((await readdir(join(dir, "knowledge-last-seen"))).every((f) => f.endsWith(".json"))).toBe(true);
  });

  it("keeps one file per workspace, and the key ignores folder order", async () => {
    expect(workspaceKey([{ path: "/b" }, { path: "/a" }])).toBe(workspaceKey([{ path: "/a" }, { path: "/b" }]));
    await writeLastSeen(dir, "one", record("r1"));
    await writeLastSeen(dir, "two", record("r2"));
    expect((await readLastSeen(dir, "one"))?.rootId).toBe("r1");
    expect((await readLastSeen(dir, "two"))?.rootId).toBe("r2");
  });

  it("keys differ per account for the same folders, and an unlinked workspace is 'local'", async () => {
    const folders = [{ path: "/w/a" }];
    expect(workspaceKey(folders, "7:42")).not.toBe(workspaceKey(folders, "8:42"));
    expect(workspaceKey(folders, "7:42")).not.toBe(workspaceKey(folders, "7:43"));
    expect(workspaceKey(folders)).toBe(workspaceKey(folders, "local"));
    await writeLastSeen(dir, workspaceKey(folders, "7:42"), record("r1"));
    expect(await readLastSeen(dir, workspaceKey(folders, "8:42"))).toBeNull();
  });

  it("clearLastSeen forgets every remembered graph (sign-out)", async () => {
    await writeLastSeen(dir, "one", record("r1"));
    await clearLastSeen(dir);
    expect(await readLastSeen(dir, "one")).toBeNull();
    await clearLastSeen(dir); // already gone: still fine
  });

  it("concurrent writes to one key leave a valid file and no temp files", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => writeLastSeen(dir, "k", record(`r${i}`))));
    expect(results.every(Boolean)).toBe(true);
    expect((await readLastSeen(dir, "k"))?.rootId).toBe("r11"); // the writes ran in order: the last wins
    expect((await readdir(join(dir, "knowledge-last-seen"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("skips a graph larger than 8 MB", async () => {
    const big = record("r1");
    big.graph = graph("r1", "x".repeat(LAST_SEEN_MAX_BYTES + 1));
    expect(await writeLastSeen(dir, "k", big)).toBe(false);
    expect(await readLastSeen(dir, "k")).toBeNull();
  });

  it("reads null for a missing file and for a torn one", async () => {
    expect(await readLastSeen(dir, "none")).toBeNull();
    await writeLastSeen(dir, "k", record("r1"));
    const [file] = await readdir(join(dir, "knowledge-last-seen"));
    await writeFile(join(dir, "knowledge-last-seen", file!), "{ torn", "utf8");
    expect(await readLastSeen(dir, "k")).toBeNull();
  });
});
