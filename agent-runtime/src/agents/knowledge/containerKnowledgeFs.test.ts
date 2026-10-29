import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ignoredByKnowledgeWatch, watchFolder, type FolderWatcher } from "./containerKnowledgeFs.js";

function fakeWatcher(): FolderWatcher & EventEmitter & { closed: number } {
  const w = new EventEmitter() as FolderWatcher & EventEmitter & { closed: number };
  w.closed = 0;
  w.close = async () => { w.closed += 1; };
  return w;
}

describe("the container folder watch", () => {
  it("never watches install or build trees, VCS stores or the host's own state", () => {
    const base = "/ws/repo";
    for (const skipped of ["node_modules", "node_modules/x/index.js", ".git/objects/ab", "dist/a.js", ".builderforce/knowledge/r.json", "pkg/.builderforce/index.idx"]) {
      expect(ignoredByKnowledgeWatch(base, `${base}/${skipped}`), skipped).toBe(true);
    }
    for (const watched of ["src/a.ts", "docs/readme.md", ".builderforce", ".builderforce/ignore", ".builderforce/partitions.json"]) {
      expect(ignoredByKnowledgeWatch(base, `${base}/${watched}`), watched).toBe(false);
    }
    expect(ignoredByKnowledgeWatch(base, base)).toBe(false);
  });

  it("reports changed paths", () => {
    const watcher = fakeWatcher();
    const seen: string[][] = [];
    watchFolder("/ws/repo", (paths) => seen.push(paths), () => watcher);
    watcher.emit("all", "change", "/ws/repo/src/a.ts");
    expect(seen).toEqual([["/ws/repo/src/a.ts"]]);
  });

  it("an error from the watcher is handled and ends the watch — it never reaches the process", async () => {
    const watcher = fakeWatcher();
    const seen: string[][] = [];
    const stop = watchFolder("/ws/repo", (paths) => seen.push(paths), () => watcher);
    // An EventEmitter with no 'error' listener would throw here; the watch registered one.
    expect(() => watcher.emit("error", new Error("EMFILE: too many open files"))).not.toThrow();
    await Promise.resolve();
    expect(watcher.closed).toBe(1);
    watcher.emit("all", "change", "/ws/repo/src/a.ts");
    expect(seen).toEqual([]);
    // Stopping afterwards is harmless, and closes once.
    expect(() => stop()).not.toThrow();
    expect(watcher.closed).toBe(1);
  });

  it("a watcher that cannot start is no watch, not a crash", () => {
    const stop = watchFolder("/ws/missing", () => undefined, vi.fn(() => { throw new Error("ENOENT"); }));
    expect(() => stop()).not.toThrow();
  });
});
