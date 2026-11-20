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

import { rootManifestWatchers } from "./rootManifestWatchers";

const folder = (name: string) => ({ name, uri: { fsPath: `/work/${name}` } });

describe("the root builderforce.json watchers", () => {
  it("watches ONE RelativePattern per folder, re-created when folders change, and disposes them all", () => {
    editor.watchers.length = 0;
    const app = folder("app");
    const api = folder("api");
    editor.folders = [app];
    const source = rootManifestWatchers("builderforce.json");
    expect(editor.watchers.map((watcher) => watcher.pattern)).toEqual([{ base: app, pattern: "builderforce.json" }]);

    const created = vi.fn();
    source.onCreate(created);
    editor.watchers[0]!.create.fire({ fsPath: "/work/app/builderforce.json" });
    expect(created).toHaveBeenCalledWith("/work/app/builderforce.json");

    editor.folders = [app, api];
    editor.foldersChanged.fire({ added: [api], removed: [] });
    expect(editor.watchers[0]!.disposed).toBe(true);
    expect(editor.watchers.slice(1).map((watcher) => watcher.pattern.base)).toEqual([app, api]);
    // The old watcher's events no longer reach the listener; the new ones do.
    editor.watchers[0]!.create.fire({ fsPath: "/work/app/builderforce.json" });
    expect(created).toHaveBeenCalledOnce();
    editor.watchers[2]!.create.fire({ fsPath: "/work/api/builderforce.json" });
    expect(created).toHaveBeenLastCalledWith("/work/api/builderforce.json");

    source.dispose();
    expect(editor.watchers.every((watcher) => watcher.disposed)).toBe(true);
    expect(editor.foldersChanged.size).toBe(0);
  });
});
