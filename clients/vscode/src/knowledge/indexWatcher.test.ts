import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COALESCE_MS, realClock } from "./indexBudget";
import { indexedPath, PathCoalescer, relativeUnder } from "./indexWatcher";

const root = { rootId: "r", rootPath: "C:/w" };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("the background indexer's watcher input (PRD 41 B2 step 5)", () => {
  it("ignores .builderforce/cache events (the fact store's own writes), other host state and skipped folders", () => {
    expect(indexedPath(".builderforce/cache/knowledge/index.sqlite")).toBe(false);
    expect(indexedPath(".builderforce/cache/knowledge/index.sqlite-wal")).toBe(false);
    expect(indexedPath("pkg/.builderforce/cache/objects/ab/cd")).toBe(false);
    expect(indexedPath(".builderforce/knowledge/r.json")).toBe(false);
    expect(indexedPath("node_modules/x/index.js")).toBe(false);
    expect(indexedPath(".git/index")).toBe(false);
    expect(indexedPath(".builderforce/ignore")).toBe(true); // a review input, not state
    expect(indexedPath("src/a.ts")).toBe(true);
  });

  it("never reports a batch for cache writes alone", async () => {
    const onBatch = vi.fn();
    const c = new PathCoalescer(realClock, onBatch);
    c.push(root, ["C:\\w\\.builderforce\\cache\\knowledge\\index.sqlite", "C:/w/.builderforce/cache/knowledge/index.sqlite-wal"]);
    await vi.advanceTimersByTimeAsync(COALESCE_MS * 5);
    expect(onBatch).not.toHaveBeenCalled();
  });

  it("coalesces a burst for 100 ms, each path once, root-relative and sorted", async () => {
    const onBatch = vi.fn();
    const c = new PathCoalescer(realClock, onBatch);
    c.push(root, ["C:\\w\\src\\b.ts", "C:/w/.builderforce/cache/knowledge/index.sqlite"]);
    await vi.advanceTimersByTimeAsync(COALESCE_MS - 10);
    c.push(root, ["C:/w/src/a.ts", "C:/w/src/b.ts", "D:/elsewhere/c.ts"]);
    await vi.advanceTimersByTimeAsync(COALESCE_MS - 10);
    expect(onBatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith("r", ["src/a.ts", "src/b.ts"]);
  });

  it("maps absolute paths onto the root, case-insensitively on Windows", () => {
    expect(relativeUnder("C:/w", "c:\\W\\src\\a.ts", true)).toBe("src/a.ts");
    expect(relativeUnder("/w", "/W/src/a.ts", false)).toBeUndefined();
    expect(relativeUnder("/w", "/wx/a.ts", false)).toBeUndefined();
  });
});
