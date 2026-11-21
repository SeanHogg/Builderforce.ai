/**
 * Keeps the `/` menu's help model current (PRD 31 §W11). The model is built from the open
 * workspace folders (no folder ⇒ every command disabled) and each folder's manifest (its
 * environments are `/launch`'s choices), so it goes stale when a folder is added or removed,
 * or a folder's manifest — `.builderforce/builderforce.json` or a legacy root file
 * (`manifestLocation.ts`) — is created, changed or deleted.
 * Each of those recomputes it — debounced, so a burst (a kit writing many files, a
 * multi-root change) recomputes once — and publishes the new model to the webviews.
 *
 * Pure over its event sources: the host wires `vscode.workspace` in (`host.ts`), tests
 * drive fakes.
 */
import { isFolderManifest } from "./manifestLocation";
import type { ComposerCommandsInit } from "./reply";

/** A subscription that can be undone (`vscode.Disposable`). */
export interface HelpRefreshDisposable {
  dispose(): void;
}

type Subscribe<T> = (listener: (value: T) => void) => HelpRefreshDisposable;

export interface HelpRefreshDeps {
  /** `vscode.workspace.onDidChangeWorkspaceFolders`. */
  onFoldersChanged: Subscribe<unknown>;
  /** The folder manifest watchers (`folderManifestWatchers.ts`): create/change/delete events carry the file's path. */
  manifestEvents: { onCreate: Subscribe<string>; onChange: Subscribe<string>; onDelete: Subscribe<string> } & HelpRefreshDisposable;
  /** The open workspace folders' paths, now. */
  folderRoots: () => readonly string[];
  /** Build the help model (`ComposerCommandHost.init`). Should never reject; a rejection is reported. */
  recompute: () => Promise<ComposerCommandsInit>;
  /** Push it to every webview. */
  publish: (init: ComposerCommandsInit) => void;
  /** A recompute or publish that failed: reported (the output channel), the menu keeps its last model. */
  report: (error: unknown) => void;
  debounceMs?: number;
}

export const HELP_REFRESH_DEBOUNCE_MS = 250;

/** Start watching. The returned disposable stops the watcher and any pending recompute. */
export function watchComposerHelp(deps: HelpRefreshDeps): HelpRefreshDisposable {
  const delay = deps.debounceMs ?? HELP_REFRESH_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  /** Bumped per recompute: a slower, older build is never published after a newer one. */
  let generation = 0;

  const schedule = (): void => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const mine = ++generation;
      void deps.recompute()
        .then((init) => {
          if (!disposed && mine === generation) deps.publish(init);
        })
        .catch((error: unknown) => deps.report(error));
    }, delay);
  };
  const onManifest = (file: string): void => {
    if (isFolderManifest(file, deps.folderRoots())) schedule();
  };

  const subscriptions: HelpRefreshDisposable[] = [
    deps.onFoldersChanged(schedule),
    deps.manifestEvents.onCreate(onManifest),
    deps.manifestEvents.onChange(onManifest),
    deps.manifestEvents.onDelete(onManifest),
    deps.manifestEvents,
  ];
  return {
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      for (const subscription of subscriptions) subscription.dispose();
    },
  };
}
