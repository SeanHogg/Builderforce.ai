import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializePack } from "@builderforce/agent-tools/knowledge";
import { configureHostKnowledgeIndex, hostKnowledgeIndexCore } from "../index/hostKnowledgeIndex";
import { knowledgeRootId } from "../knowledgeRoots";
import { configureLoadedPacks, loadedPackRegistry } from "./loadedPackRegistry";
import { FOREIGN_ROOT, leasePack, memoryMemento } from "./packFixture.test-util";
import { editorPackRetrieval, indexPack, readPackFile, reindexLoadedPacks, withLoadedPacks, writePackFile } from "./packIndexing";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "bf-packs-"));
  configureHostKnowledgeIndex({ workspaceRoots: () => [], idle: () => undefined, embedder: async () => undefined, symbolFiles: async () => [] });
  configureLoadedPacks(memoryMemento());
});

afterEach(async () => {
  configureHostKnowledgeIndex({ workspaceRoots: () => [] });
  configureLoadedPacks(memoryMemento());
  await rm(dir, { recursive: true, force: true });
});

describe("pack files", () => {
  it("writes canonically and reads back, creating the library folder", async () => {
    const pack = await leasePack();
    const file = path.join(dir, "packs", "nested", "lease.bfpack");
    await writePackFile(file, pack);
    expect(serializePack(await readPackFile(file))).toBe(serializePack(pack));
  });
});

describe("indexPack", () => {
  it("indexes the pack's cards under its own root, idempotently", async () => {
    const pack = await leasePack();
    const cards = await indexPack(pack);
    expect(cards).toBeGreaterThan(0);
    const size = await hostKnowledgeIndexCore(FOREIGN_ROOT).size();
    expect(size).toBeGreaterThan(0);
    await indexPack(pack);
    expect(await hostKnowledgeIndexCore(FOREIGN_ROOT).size()).toBe(size);
  });
});

describe("a pack of an open workspace folder's own root", () => {
  it("is never indexed from its file: the folder's own review owns that index (at load, at update, at startup)", async () => {
    const owned = knowledgeRootId(dir);
    configureHostKnowledgeIndex({ workspaceRoots: () => [dir], idle: () => undefined, embedder: async () => undefined, symbolFiles: async () => [] });
    const stale = await leasePack(owned, "mine");
    expect(await indexPack(stale)).toBe(0);
    expect(await hostKnowledgeIndexCore(owned).size()).toBe(0);

    const file = path.join(dir, "mine.bfpack");
    await writePackFile(file, stale);
    await loadedPackRegistry().remember("mine", { path: file, rootId: owned, title: "Mine", loadedAt: "" });
    await reindexLoadedPacks(vi.fn());
    expect(await hostKnowledgeIndexCore(owned).size()).toBe(0);
  });
});

describe("pack files are parsed once per change", () => {
  it("serves an unchanged file from the cache and re-reads it after a write", async () => {
    const pack = await leasePack();
    const file = path.join(dir, "cache.bfpack");
    await writePackFile(file, pack);
    const first = await readPackFile(file);
    expect(await readPackFile(file)).toBe(first);
    await writePackFile(file, { ...pack, title: "Renamed" });
    expect((await readPackFile(file)).title).toBe("Renamed");
  });
});

describe("reindexLoadedPacks", () => {
  it("re-indexes each remembered pack whose file exists and reports (not forgets) a missing one", async () => {
    const pack = await leasePack();
    const file = path.join(dir, "lease.bfpack");
    await writePackFile(file, pack);
    const reg = loadedPackRegistry();
    await reg.remember("lease", { path: file, rootId: pack.rootId, title: pack.title, loadedAt: pack.createdAt });
    await reg.remember("gone", { path: path.join(dir, "gone.bfpack"), rootId: "vscode:f-gone", title: "Gone", loadedAt: "" });

    expect(await hostKnowledgeIndexCore(pack.rootId).size()).toBe(0);
    const onError = vi.fn();
    await reindexLoadedPacks(onError);

    expect(await hostKnowledgeIndexCore(pack.rootId).size()).toBeGreaterThan(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toContain("gone");
    expect(reg.all().map((e) => e.name)).toEqual(["gone", "lease"]);
  });
});

describe("the editor's pack retrieval", () => {
  it("recalls a loaded pack with no workspace index at all", async () => {
    const pack = await leasePack();
    await indexPack(pack);
    await loadedPackRegistry().remember(pack.name, { path: "/x.bfpack", rootId: pack.rootId, title: pack.title, loadedAt: pack.createdAt });
    const out = await withLoadedPacks(undefined).recall("lease termination");
    expect(out.hits.some((h) => h.path === "lease.md")).toBe(true);
    const direct = await editorPackRetrieval().recall([pack.rootId], "lease termination");
    expect(direct.hits.length).toBeGreaterThan(0);
  });
});
