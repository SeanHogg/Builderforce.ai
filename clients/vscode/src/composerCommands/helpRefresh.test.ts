import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchComposerHelp } from "./helpRefresh";
import { isFolderManifest } from "./manifestLocation";
import type { ComposerCommandsInit } from "./reply";

/** One event source: `fire` reaches every listener; `dispose` unsubscribes. */
function emitter<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe: (listener: (value: T) => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: (value: T) => { for (const listener of listeners) listener(value); },
    size: () => listeners.size,
  };
}

const root = path.resolve("/work/app");
const other = path.resolve("/work/other");
const help = (n: number): ComposerCommandsInit => ({ help: { entries: [{ id: `v${n}` }] } as unknown as ComposerCommandsInit["help"] });

function setup() {
  const folders = emitter<unknown>();
  const created = emitter<string>();
  const changed = emitter<string>();
  const deleted = emitter<string>();
  const watcherDispose = vi.fn();
  let version = 0;
  const recompute = vi.fn(async () => help(++version));
  const publish = vi.fn();
  const report = vi.fn();
  const roots = [root];
  const watching = watchComposerHelp({
    onFoldersChanged: folders.subscribe,
    manifestEvents: { onCreate: created.subscribe, onChange: changed.subscribe, onDelete: deleted.subscribe, dispose: watcherDispose },
    folderRoots: () => roots,
    recompute,
    publish,
    report,
    debounceMs: 100,
  });
  return { folders, created, changed, deleted, watcherDispose, recompute, publish, report, roots, watching };
}

describe("the / menu's help refresh", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("recomputes and publishes when a workspace folder is added or removed", async () => {
    const { folders, recompute, publish } = setup();
    folders.fire({ added: [], removed: [] });
    expect(recompute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(recompute).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(help(1));
  });

  it("recomputes when a folder's .builderforce/builderforce.json changes, as for a legacy root one", async () => {
    const { changed, recompute } = setup();
    changed.fire(path.join(root, ".builderforce", "builderforce.json"));
    await vi.advanceTimersByTimeAsync(100);
    expect(recompute).toHaveBeenCalledOnce();
    changed.fire(path.join(root, "bfwc.app.json"));
    await vi.advanceTimersByTimeAsync(100);
    expect(recompute).toHaveBeenCalledTimes(2);
  });

  it("recomputes when a ROOT builderforce.json is created, changed or deleted — debounced into one", async () => {
    const { created, changed, deleted, recompute, publish } = setup();
    created.fire(path.join(root, "builderforce.json"));
    changed.fire(path.join(root, "builderforce.json"));
    deleted.fire(path.join(root, "builderforce.json"));
    await vi.advanceTimersByTimeAsync(100);
    expect(recompute).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
  });

  it("ignores a builderforce.json below a root or outside every root", async () => {
    const { changed, recompute, roots } = setup();
    changed.fire(path.join(root, "node_modules", "pkg", "builderforce.json"));
    changed.fire(path.join(other, "builderforce.json"));
    await vi.advanceTimersByTimeAsync(100);
    expect(recompute).not.toHaveBeenCalled();
    roots.push(other); // a folder added later is a root too
    changed.fire(path.join(other, "builderforce.json"));
    await vi.advanceTimersByTimeAsync(100);
    expect(recompute).toHaveBeenCalledOnce();
  });

  it("disposes the watcher and its subscriptions, and publishes nothing pending", async () => {
    const { folders, created, watcherDispose, publish, watching } = setup();
    folders.fire({});
    watching.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(publish).not.toHaveBeenCalled();
    expect(watcherDispose).toHaveBeenCalledOnce();
    expect(folders.size()).toBe(0);
    expect(created.size()).toBe(0);
  });

  it("never publishes an older build after a newer one", async () => {
    const { folders, recompute, publish } = setup();
    let release!: (value: ComposerCommandsInit) => void;
    recompute.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    folders.fire({});
    await vi.advanceTimersByTimeAsync(100);
    folders.fire({});
    await vi.advanceTimersByTimeAsync(100);
    release(help(99));
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalledWith(help(99));
  });

  it("reports a recompute that rejects, or a publish that throws, and keeps refreshing", async () => {
    const { folders, recompute, publish, report } = setup();
    const broken = new Error("registry broke");
    recompute.mockRejectedValueOnce(broken);
    folders.fire({});
    await vi.advanceTimersByTimeAsync(100);
    expect(report).toHaveBeenCalledWith(broken);
    expect(publish).not.toHaveBeenCalled();

    const thrown = new Error("webview gone");
    publish.mockImplementationOnce(() => { throw thrown; });
    folders.fire({});
    await vi.advanceTimersByTimeAsync(100);
    expect(report).toHaveBeenLastCalledWith(thrown);

    folders.fire({});
    await vi.advanceTimersByTimeAsync(100);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("matches roots case-insensitively on Windows only", () => {
    expect(isFolderManifest(path.join(root, "builderforce.json"), [root])).toBe(true);
    expect(isFolderManifest(path.join(root, "package.json"), [root])).toBe(false);
    expect(isFolderManifest(path.join(root, ".builderforce", "builderforce.json"), [root])).toBe(true);
    expect(isFolderManifest(path.join(root, ".builderforce", "hooks.json"), [root])).toBe(false);
    expect(isFolderManifest(path.join(root, "web", ".builderforce", "builderforce.json"), [root])).toBe(false);
    expect(isFolderManifest(path.join(root.toUpperCase(), "builderforce.json"), [root])).toBe(process.platform === "win32" || root === root.toUpperCase());
  });
});
