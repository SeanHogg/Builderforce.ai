import { describe, expect, it, vi } from "vitest";

/** A minimal `vscode`: emitters, `RelativePattern`, and watchers the test can fire and inspect. */
const editor = vi.hoisted(() => {
  type Listener<T> = (value: T) => void;
  class EventEmitter<T> {
    private listeners = new Set<Listener<T>>();
    readonly event = (listener: Listener<T>) => {
      this.listeners.add(listener);
      return { dispose: () => { this.listeners.delete(listener); } };
    };
    fire(value: T): void { for (const listener of [...this.listeners]) listener(value); }
    dispose(): void { this.listeners.clear(); }
    get size(): number { return this.listeners.size; }
  }
  interface FakeWatcher {
    pattern: { base: unknown; pattern: string };
    create: EventEmitter<{ fsPath: string }>;
    disposed: boolean;
  }
  const watchers: FakeWatcher[] = [];
  return {
    EventEmitter,
    watchers,
    folders: [] as Array<{ name: string; uri: { fsPath: string } }>,
    foldersChanged: new EventEmitter<unknown>(),
    createWatcher: (pattern: { base: unknown; pattern: string }) => {
      const watcher: FakeWatcher = { pattern, create: new EventEmitter(), disposed: false };
      watchers.push(watcher);
      const change = new EventEmitter<{ fsPath: string }>();
      const remove = new EventEmitter<{ fsPath: string }>();
      return {
        onDidCreate: watcher.create.event,
        onDidChange: change.event,
        onDidDelete: remove.event,
        dispose: () => { watcher.disposed = true; },
      };
    },
  };
});

vi.mock("vscode", () => ({
  EventEmitter: editor.EventEmitter,
  RelativePattern: class RelativePattern {
    constructor(readonly base: unknown, readonly pattern: string) {}
  },
  workspace: {
    get workspaceFolders() { return editor.folders; },
    createFileSystemWatcher: (pattern: { base: unknown; pattern: string }) => editor.createWatcher(pattern),
    onDidChangeWorkspaceFolders: (listener: (value: unknown) => void) => editor.foldersChanged.event(listener),
  },
}));

import { folderManifestWatchers } from "./folderManifestWatchers";
import { MANIFEST_READ_ORDER } from "./manifestLocation";

const folder = (name: string) => ({ name, uri: { fsPath: `/work/${name}` } });

describe("the folder manifest watchers", () => {
  it("watch .builderforce/builderforce.json first, then each legacy root file", () => {
    expect(MANIFEST_READ_ORDER).toEqual([".builderforce/builderforce.json", "builderforce.json", "bfwc.app.json"]);
    editor.watchers.length = 0;
    const app = folder("app");
    editor.folders = [app];
    const source = folderManifestWatchers(MANIFEST_READ_ORDER);
    expect(editor.watchers.map((watcher) => watcher.pattern)).toEqual(MANIFEST_READ_ORDER.map((pattern) => ({ base: app, pattern })));
    source.dispose();
  });

  it("watch ONE RelativePattern per folder and path, re-created when folders change, and dispose them all", () => {
    editor.watchers.length = 0;
    const app = folder("app");
    const api = folder("api");
    editor.folders = [app];
    const source = folderManifestWatchers([".builderforce/builderforce.json"]);
    expect(editor.watchers.map((watcher) => watcher.pattern)).toEqual([{ base: app, pattern: ".builderforce/builderforce.json" }]);

    const created = vi.fn();
    source.onCreate(created);
    editor.watchers[0]!.create.fire({ fsPath: "/work/app/.builderforce/builderforce.json" });
    expect(created).toHaveBeenCalledWith("/work/app/.builderforce/builderforce.json");

    editor.folders = [app, api];
    editor.foldersChanged.fire({ added: [api], removed: [] });
    expect(editor.watchers[0]!.disposed).toBe(true);
    expect(editor.watchers.slice(1).map((watcher) => watcher.pattern.base)).toEqual([app, api]);
    // The old watcher's events no longer reach the listener; the new ones do.
    editor.watchers[0]!.create.fire({ fsPath: "/work/app/.builderforce/builderforce.json" });
    expect(created).toHaveBeenCalledOnce();
    editor.watchers[2]!.create.fire({ fsPath: "/work/api/.builderforce/builderforce.json" });
    expect(created).toHaveBeenLastCalledWith("/work/api/.builderforce/builderforce.json");

    source.dispose();
    expect(editor.watchers.every((watcher) => watcher.disposed)).toBe(true);
    expect(editor.foldersChanged.size).toBe(0);
  });
});
