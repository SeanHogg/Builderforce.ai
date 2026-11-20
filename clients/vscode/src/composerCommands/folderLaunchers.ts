/**
 * The local launchers this extension host has started: ONE per workspace folder. A second
 * `/launch` in the same folder reuses it (unless it asks for another environment), `/launch
 * stop` closes it, and disposing the registry — on extension deactivate, through
 * `context.subscriptions` — closes every one, so no loopback server outlives the editor.
 */

export interface RunningLauncher {
  /** `https://localhost:<port>/#token=…` — the fragment carries the per-launch token. */
  readonly url: string;
  /** The local CA the launcher's HTTPS certificate chains to (a launcher serving TLS). */
  readonly caCertPath?: string;
  close(): Promise<void>;
}

interface Entry {
  environment: string | undefined;
  launcher: Promise<RunningLauncher>;
}

export class FolderLaunchers {
  private readonly byFolder = new Map<string, Entry>();

  /** The launcher running for a folder (and the environment it was started for), if any. */
  running(folder: string): { environment: string | undefined; launcher: Promise<RunningLauncher> } | undefined {
    return this.byFolder.get(folder);
  }

  /**
   * Start one for the folder and hold it. Registered BEFORE it resolves, so two quick
   * `/launch`es share one start; a start that fails is forgotten again.
   */
  start(folder: string, environment: string | undefined, start: () => Promise<RunningLauncher>): Promise<RunningLauncher> {
    const launcher = start();
    const entry: Entry = { environment, launcher };
    this.byFolder.set(folder, entry);
    launcher.catch(() => {
      if (this.byFolder.get(folder) === entry) this.byFolder.delete(folder);
    });
    return launcher;
  }

  /** Close the folder's launcher. False when none was running. */
  async stop(folder: string): Promise<boolean> {
    const entry = this.byFolder.get(folder);
    if (!entry) return false;
    this.byFolder.delete(folder);
    const launcher = await entry.launcher.catch(() => undefined);
    await launcher?.close();
    return launcher !== undefined;
  }

  /** Close them all (deactivate). Each close is started at once; failures are reported to `onError`. */
  closeAll(onError: (error: unknown) => void): Promise<void> {
    const entries = [...this.byFolder.values()];
    this.byFolder.clear();
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
