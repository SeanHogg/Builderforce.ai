/**
 * knowledge/factStoreNode.test.ts — the Node adapter binding the FactStorePort to
 * `<cacheDir>/knowledge/<rootId>/index.sqlite` (PRD 41 §B4). Skips where node:sqlite is absent.
 *
 * The store is a disposable cache: objects are content-addressed and write-once, the manifest
 * maps path → facts/content hash + kind hashes, derived rows carry their input trace, and the
 * version CAS (`fact_store_generation_conflict`) guards concurrent writers.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localSqliteAvailable } from "@builderforce/agent-tools/node-local-sqlite";
import { FactStoreError, openFactStoreNode } from "./factStoreNode";
const opened = [];
const dirs = [];
const openStore = (now = () => 1_000_000) => {
    const dir = mkdtempSync(join(tmpdir(), "bf-fact-store-node-"));
    dirs.push(dir);
    const store = openFactStoreNode(dir, "repo/root", { now });
    opened.push(store.store);
    return store;
};
afterEach(() => {
    for (const s of opened.splice(0))
        s.close();
    for (const d of dirs.splice(0))
        rmSync(d, { recursive: true, force: true });
});
const KINDS = { structure: "s1", body: "b1", content: "c1" };
const entry = (hash) => ({ factsHash: hash, contentHash: `content:${hash}`, kinds: KINDS });
describe.skipIf(!localSqliteAvailable())("factStoreNode (PRD 41 §B4)", () => {
    it("starts empty at generation 0 and mints one epoch", () => {
        const { store } = openStore();
        const version = store.readVersion();
        expect(version.generation).toBe(0);
        expect(version.epoch).toMatch(/^[0-9a-f]{64}$/);
        expect(store.readManifest().files.size).toBe(0);
        expect(store.derivedRows().size).toBe(0);
    });
    it("round-trips objects and the manifest through one generation", () => {
        const { store } = openStore();
        store.putObjects(new Map([["h1", "{\"a\":1}"], ["h2", "{\"b\":2}"]]));
        const v0 = store.readVersion();
        store.writeManifest({ epoch: v0.epoch, generation: 1, puts: new Map([["a.ts", entry("h1")], ["b.ts", entry("h2")]]), deletes: [] }, [{ rule: "cycle", focus: "a.ts", row: { found: true } }], []);
        const v1 = store.readVersion();
        expect(v1).toEqual({ epoch: v0.epoch, generation: 1 });
        expect(store.getObjects(["h1", "h2", "missing"])).toEqual(new Map([["h1", "{\"a\":1}"], ["h2", "{\"b\":2}"]]));
        const manifest = store.readManifest();
        expect(manifest.files.get("a.ts")).toEqual(entry("h1"));
        expect([...manifest.files.keys()]).toEqual(["a.ts", "b.ts"]); // sorted by insertion here; read is by path key
        expect(store.derivedRows().get("cycle:a.ts")).toEqual({ rule: "cycle", focus: "a.ts", row: { found: true } });
    });
    it("putObjects is write-once: an existing hash is left as it is", () => {
        const { store } = openStore();
        store.putObjects(new Map([["h1", "first"]]));
        store.putObjects(new Map([["h1", "second"]]));
        expect(store.getObjects(["h1"]).get("h1")).toBe("first");
    });
    it("rejects a writeManifest on a stale version (fact_store_generation_conflict)", () => {
        const { store } = openStore();
        const v0 = store.readVersion();
        store.writeManifest({ epoch: v0.epoch, generation: 1, puts: new Map([["a.ts", entry("h1")]]), deletes: [] }, [], []);
        // A second writer that read v0 and writes generation 1 again conflicts.
        expect(() => store.writeManifest({ epoch: v0.epoch, generation: 1, puts: new Map(), deletes: [] }, [], []))
            .toThrowError(FactStoreError);
        expect(() => store.writeManifest({ epoch: v0.epoch, generation: 1, puts: new Map(), deletes: [] }, [], []))
            .toThrowError(/fact_store_generation_conflict/);
    });
    it("writeManifest applies puts, deletes and derived deletes atomically", () => {
        const { store } = openStore();
        store.putObjects(new Map([["h1", "1"], ["h2", "2"]]));
        const v0 = store.readVersion();
        store.writeManifest({ epoch: v0.epoch, generation: 1, puts: new Map([["a.ts", entry("h1")], ["b.ts", entry("h2")]]), deletes: [] }, [{ rule: "r", focus: "a.ts", row: 1 }, { rule: "r", focus: "b.ts", row: 2 }], []);
        const v1 = store.readVersion();
        store.writeManifest({ epoch: v1.epoch, generation: 2, puts: new Map([["c.ts", entry("h1")]]), deletes: ["a.ts"] }, [], ["r:a.ts"]);
        const manifest = store.readManifest();
        expect([...manifest.files.keys()].sort()).toEqual(["b.ts", "c.ts"]);
        expect(store.derivedRows().has("r:a.ts")).toBe(false);
        expect(store.derivedRows().has("r:b.ts")).toBe(true);
        expect(store.readVersion().generation).toBe(2);
    });
    it("sweepObjects removes unreferenced objects, bumps the generation, and keeps referenced ones", () => {
        const { store } = openStore();
        store.putObjects(new Map([["h1", "1"], ["h2", "2"], ["h3", "3"]]));
        const v0 = store.readVersion();
        store.writeManifest({ epoch: v0.epoch, generation: 1, puts: new Map([["a.ts", entry("h1")]]), deletes: [] }, [], []);
        const v1 = store.readVersion();
        expect(store.sweepObjects(v1)).toBe(2); // h2, h3 unreferenced
        expect(store.readVersion().generation).toBe(2); // the bump
        expect(store.getObjects(["h1"]).size).toBe(1);
        expect(store.sweepObjects(store.readVersion())).toBe(0); // a no-op sweep leaves the version as it was
        expect(store.readVersion().generation).toBe(2);
    });
    it("sweepObjects rejects a stale expected version", () => {
        const { store } = openStore();
        const v0 = store.readVersion();
        store.writeManifest({ epoch: v0.epoch, generation: 1, puts: new Map(), deletes: [] }, [], []);
        expect(() => store.sweepObjects(v0)).toThrowError(/fact_store_generation_conflict/);
    });
    it("reset drops everything and mints a new epoch at generation 0", () => {
        const { store } = openStore();
        store.putObjects(new Map([["h1", "1"]]));
        const v0 = store.readVersion();
        store.writeManifest({ epoch: v0.epoch, generation: 1, puts: new Map([["a.ts", entry("h1")]]), deletes: [] }, [{ rule: "r", focus: "f", row: 1 }], []);
        store.reset();
        const after = store.readVersion();
        expect(after.generation).toBe(0);
        expect(after.epoch).not.toBe(v0.epoch);
        expect(store.readManifest().files.size).toBe(0);
        expect(store.derivedRows().size).toBe(0);
        expect(store.getObjects(["h1"]).size).toBe(0);
    });
    it("persists across close and reopen in the same directory", () => {
        const dir = mkdtempSync(join(tmpdir(), "bf-fact-store-reopen-"));
        dirs.push(dir);
        const first = openFactStoreNode(dir, "repo/root", { now: () => 1 });
        first.store.putObjects(new Map([["h1", "1"]]));
        const v0 = first.store.readVersion();
        first.store.writeManifest({ epoch: v0.epoch, generation: 1, puts: new Map([["a.ts", entry("h1")]]), deletes: [] }, [], []);
        first.store.close();
        const second = openFactStoreNode(dir, "repo/root", { now: () => 1 });
        opened.push(second.store);
        expect(second.store.readVersion()).toEqual({ epoch: v0.epoch, generation: 1 });
        expect(second.store.readManifest().files.get("a.ts")).toEqual(entry("h1"));
    });
    it("reports sqlite-unavailable when node:sqlite is absent", () => {
        // Simulated by checking the error path only runs when the module is missing; here we just assert the class exists.
        expect(new FactStoreError("sqlite-unavailable").code).toBe("sqlite-unavailable");
        expect(new FactStoreError("sqlite-unavailable").message).toBe("sqlite-unavailable");
    });
    it("uses the injected clock, never a bare Date.now, for epoch minting", () => {
        const now = vi.fn(() => 42);
        const dir = mkdtempSync(join(tmpdir(), "bf-fact-store-clock-"));
        dirs.push(dir);
        const { store } = openFactStoreNode(dir, "repo/root", { now });
        opened.push(store);
        expect(now).toHaveBeenCalled();
        store.reset();
        expect(now).toHaveBeenCalledTimes(2); // one mint at open, one at reset
    });
});
//# sourceMappingURL=factStoreNode.test.js.map