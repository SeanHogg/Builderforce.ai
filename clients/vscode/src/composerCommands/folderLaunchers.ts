/**
 * The local launchers this extension host has started: ONE per workspace folder, launched folder or
 * launched page. A second `/launch` of the same one reuses it — also while it is still starting, so two
 * quick `/launch`es never start two servers — unless it asks for another environment, which replaces it.
 * `/launch stop` closes it, and disposing the registry — on extension deactivate, through
 * `context.subscriptions` — closes every one, so no loopback server outlives the editor.
 *
 * The key rule lives HERE and nowhere else: the real path (`realPath`, the workspace port's own), made
 * canonical (`canonicalKey`). Each entry also remembers the paths it was started and reached by, so it
 * is found again by the path that was typed even after the file it names was deleted or a folder gained
 * an `index.html` (`held`).
 */
import type { LauncherCa } from "./launcherTrust";
import { canonicalKey, realPathOrSelf } from "./realPath";

export interface RunningLauncher {
  /** `https://localhost:<port>/#token=…` — the fragment carries the per-launch token. */
  readonly url: string;
  /** The local CA the launcher's HTTPS certificate chains to (`LocalLauncher.ca`); null/absent without TLS. */
  readonly ca?: LauncherCa | null;
  close(): Promise<void>;
}

/** A held launcher, as callers see it. */
export interface HeldLauncher {
  /** The canonical real-path key it is held under — stopping a held launcher goes by it, not by resolving `path` again (a file deleted or a link changed since). */
  readonly key: string;
  /** The path it was started for (a folder, or a page's file). */
  readonly path: string;
  environment: string | undefined;
  launcher: Promise<RunningLauncher>;
}

interface Entry extends HeldLauncher {
  /** Canonical keys of every path it answers to: where it was started, and each path it was reached by. */
  names: Set<string>;
}

export class FolderLaunchers {
  private readonly byKey = new Map<string, Entry>();

  /** `realPath` is the workspace port's, so launchers and the scope checks resolve links the same way. */
  constructor(private readonly realPath: (file: string) => Promise<string> = realPathOrSelf) {}

  private async keyOf(path: string): Promise<string> {
    return canonicalKey(await this.realPath(path));
  }

  /** The launcher running (or starting) for a folder or page, if any. */
  async running(path: string): Promise<HeldLauncher | undefined> {
    return this.byKey.get(await this.keyOf(path));
  }

  /**
   * The launcher any of these paths names, by real path or by a path it was started or reached by —
   * without touching the file system for the second kind, so it still answers after a file is gone.
   */
  async held(paths: readonly string[]): Promise<HeldLauncher | undefined> {
    for (const path of paths) {
      const key = await this.keyOf(path);
      const byKey = this.byKey.get(key);
      if (byKey) return byKey;
      for (const entry of this.byKey.values()) if (entry.names.has(canonicalKey(path)) || entry.names.has(key)) return entry;
    }
    return undefined;
  }

  /**
   * Start one for the folder and hold it, remembering the `reachedBy` paths too. Registered BEFORE it
   * resolves — and with nothing awaited between the lookup and the registration — so two quick calls
   * share one start (the second gets the same launcher); a start that fails is forgotten again.
   * Another environment closes the held launcher first, and this one starts only after that close.
   */
  async start(
    folder: string,
    environment: string | undefined,
    start: () => Promise<RunningLauncher>,
    reachedBy: readonly string[] = [],
  ): Promise<RunningLauncher> {
    const key = await this.keyOf(folder);
    const prior = this.byKey.get(key);
    if (prior && prior.environment === environment) return prior.launcher;
    // Registered at once (nothing awaited since the lookup), so the NEWEST request always replaces the newest entry. A held launcher
    // for another environment is closed first, and this start waits for that close — no two servers overlap, and a close that fails
    // rejects this launcher (which the caller reports).
    const launcher = (prior ? this.stopEntry(prior) : Promise.resolve()).then(() => start());
    const names = new Set([key, ...reachedBy.map(canonicalKey)]);
    const entry: Entry = { key, path: folder, environment, launcher, names };
    this.byKey.set(key, entry);
    launcher.catch(() => {
      if (this.byKey.get(key) === entry) this.byKey.delete(key);
    });
    return launcher;
  }

  /** Close the folder's launcher (by path, or the held one given). False when none was running. */
  async stop(target: string | HeldLauncher): Promise<boolean> {
    const entry = this.byKey.get(typeof target === "string" ? await this.keyOf(target) : target.key);
    return entry ? this.stopEntry(entry) : false;
  }

  private async stopEntry(entry: Entry): Promise<boolean> {
    if (this.byKey.get(entry.key) === entry) this.byKey.delete(entry.key);
    const launcher = await entry.launcher.catch(() => undefined);
    await launcher?.close();
    return launcher !== undefined;
  }

  /** Close them all (deactivate). Each close is started at once; failures are reported to `onError`. */
  closeAll(onError: (error: unknown) => void): Promise<void> {
    const entries = [...this.byKey.values()];
    this.byKey.clear();
    return Promise.all(entries.map(async (entry) => {
      try {
        const launcher = await entry.launcher.catch(() => undefined);
        await launcher?.close();
      } catch (error) {
        onError(error);
      }
    })).then(() => undefined);
  }
}
