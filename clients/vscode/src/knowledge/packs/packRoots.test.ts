import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({ l10n: { t: (m: string) => m } }));

import { configureHostKnowledgeIndex } from "../index/hostKnowledgeIndex";
import { knowledgeRootId } from "../knowledgeRoots";
import { configureLoadedPacks, loadedPackRegistry, recordOfPack } from "./loadedPackRegistry";
import { FOREIGN_ROOT, leasePack, memoryMemento } from "./packFixture.test-util";
import { writePackFile } from "./packIndexing";
import { assertWritable, packRootGraph, packScopeRows, readOnlyPack } from "./packRoots";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import type { KnowledgeCall } from "../knowledgeProtocol";

let dir: string | undefined;

afterEach(async () => {
  configureLoadedPacks(memoryMemento());
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function loaded(): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), "bf-roots-"));
  const pack = await leasePack();
  const file = path.join(dir, "lease.bfpack");
  await writePackFile(file, pack);
  configureLoadedPacks(memoryMemento());
  await loadedPackRegistry().remember(pack.name, recordOfPack(pack, file));
  return file;
}

describe("loaded packs as read-only knowledge-view roots", () => {
  it("lists one read-only row per loaded pack whose root no workspace folder holds", async () => {
    const file = await loaded();
    expect(readOnlyPack(FOREIGN_ROOT)?.name).toBe("lease-docs");
    expect(readOnlyPack("vscode:other")).toBeUndefined();
    await rm(file); // the rows come from the registry's record: no pack file is read to list a pack
    const rows = packScopeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rootId: FOREIGN_ROOT, title: "Lease docs", readOnly: true, pack: "lease-docs", packs: expect.any(Array) });
  });

  it("is not read-only when an open workspace folder holds the pack's root", async () => {
    await loaded();
    const folder = dir!;
    const owned = knowledgeRootId(folder);
    await loadedPackRegistry().remember("mine", { path: "/x.bfpack", rootId: owned, title: "Mine", loadedAt: "" });
    configureHostKnowledgeIndex({ workspaceRoots: () => [folder], idle: () => undefined, embedder: async () => undefined, symbolFiles: async () => [] });
    try {
      expect(readOnlyPack(owned)).toBeUndefined();
      expect(packScopeRows().map((r) => r.rootId)).toEqual([FOREIGN_ROOT]);
      expect(() => assertWritable({ op: "remember", rootId: owned, ref: "src:x::a.md", content: "c" }, undefined)).not.toThrow();
    } finally {
      configureHostKnowledgeIndex({ workspaceRoots: () => [] });
    }
  });

  it("loads the pack's graph from its file, honouring the query, and is null when the file is gone", async () => {
    const file = await loaded();
    const entry = readOnlyPack(FOREIGN_ROOT)!;
    const graph = await packRootGraph(entry, {});
    expect(graph?.nodes.some((n) => String(n.ref).endsWith("lease.md"))).toBe(true);
    await rm(file);
    await expect(packRootGraph(entry, {})).rejects.toThrow();
    expect(await packRootGraph({ ...entry, path: undefined as unknown as string }, {})).toBeNull();
  });

  it("refuses every write or review aimed at a pack root, and nothing else", async () => {
    await loaded();
    const refused: KnowledgeCall[] = [
      { op: "plan", req: { rootId: FOREIGN_ROOT }, stream: "s" },
      { op: "remember", rootId: FOREIGN_ROOT, ref: "src:x::a.md", content: "c" },
      { op: "pinpoint", rootId: FOREIGN_ROOT, image: "data:" },
      { op: "history", rootId: FOREIGN_ROOT },
      { op: "syncStatus", rootId: FOREIGN_ROOT },
      { op: "applyFix", rootId: FOREIGN_ROOT, finding: {} as never },
    ];
    for (const call of refused) expect(() => assertWritable(call, undefined)).toThrow(/read-only/);
    expect(() => assertWritable({ op: "deleteFact", ref: "fact:x" }, FOREIGN_ROOT)).toThrow(/read-only/);
    expect(() => assertWritable({ op: "deleteFact", ref: "fact:x" }, "vscode:other")).not.toThrow();
    expect(() => assertWritable({ op: "load", rootId: FOREIGN_ROOT }, undefined)).not.toThrow();
    expect(() => assertWritable({ op: "plan", req: { rootId: "vscode:other" }, stream: "s" }, undefined)).not.toThrow();
  });
});
