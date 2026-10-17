/**
 * Installed packages that survive a reload.
 *
 * The shared runtime keeps `node_modules` across runs in ONE page session, so an
 * unchanged `package.json` never reinstalls twice in a tab. A reload lost all of it:
 * every visit started with a full `npm install`. This keeps the installed tree in
 * IndexedDB (the runtime's `createSnapshotStore`), keyed by the workspace and its
 * manifest, and writes it back on the next visit instead of reinstalling.
 *
 * ONE pair, used by both installers: the workspace run (`useWorkspaceRun`'s
 * `ensureInstalled`, through {@link installOrRestore}) and the agent's shell
 * (`workspaceShell.ts`, around an install command).
 *
 * Every operation fails soft. A snapshot that cannot be read, written or imported is
 * a miss, and a miss is a normal install — never a broken run.
 */
import type { PreviewRuntime, SnapshotStore } from '@seanhogg/builderforce-webcontainers';
import { hashString } from '@/lib/hashString';
import type { WorkspaceId } from '@/lib/workspace/workspaceId';

/** What a snapshot reads from and writes to — the whole runtime is not needed. */
export type SnapshotRuntime = Pick<PreviewRuntime, 'exportZip' | 'importZip' | 'fs'>;

/** What the snapshot holds: the installed tree and the lockfile that describes it. */
const SNAPSHOT_PATHS = ['node_modules', 'package-lock.json'];

let defaultStore: Promise<SnapshotStore | null> | null = null;

/** Create the page's store; null when the package cannot provide one (a miss, not an error). */
async function openInstallSnapshotStore(): Promise<SnapshotStore | null> {
  try {
    const { createSnapshotStore } = await import('@seanhogg/builderforce-webcontainers');
    return createSnapshotStore({ name: 'builderforce-install-snapshots', maxEntries: 4 });
  } catch {
    return null;
  }
}

/** The page's snapshot store, created on first use (the package is already loaded by then). */
function installSnapshotStore(): Promise<SnapshotStore | null> {
  defaultStore ??= openInstallSnapshotStore();
  return defaultStore;
}

/**
 * The snapshot key: the workspace plus its manifest (and lockfile, when there is one).
 * Null when there is no `package.json` — nothing to install, nothing to snapshot.
 */
export function installSnapshotKey(
  workspaceId: WorkspaceId,
  files: Readonly<Record<string, string | undefined>>,
): string | null {
  const manifest = files['package.json'];
  if (!manifest) return null;
  return `${workspaceId}:${hashString(manifest)}:${hashString(files['package-lock.json'] ?? '')}`;
}

/** True when the runtime already holds installed packages (this page session installed them). */
export function hasInstalledPackages(runtime: Pick<PreviewRuntime, 'fs'>): boolean {
  return runtime.fs.list().some((path) => path.startsWith('/node_modules/'));
}

/** Write the snapshot under `key` into the runtime. True when it was restored. */
export async function restoreInstalledPackages(
  runtime: SnapshotRuntime,
  key: string,
  store?: SnapshotStore | null,
): Promise<boolean> {
  try {
    const snapshots = store === undefined ? await installSnapshotStore() : store;
    const zip = await snapshots?.load(key);
    if (!zip) return false;
    runtime.importZip(zip);
    return true;
  } catch {
    return false;
  }
}

/** Save the runtime's installed packages under `key`. True when stored. */
export async function saveInstalledPackages(
  runtime: SnapshotRuntime,
  key: string,
  store?: SnapshotStore | null,
): Promise<boolean> {
  try {
    // Resolved BEFORE the (synchronous) export, so a fire-and-forget caller returns first.
    const snapshots = store === undefined ? await installSnapshotStore() : store;
    if (!snapshots) return false;
    return await snapshots.save(key, runtime.exportZip({ include: SNAPSHOT_PATHS, level: 1 }));
  } catch {
    return false;
  }
}

/**
 * Restore the installed packages for `key`, or install and snapshot them.
 * Resolves with the install's exit code — 0 when restored.
 */
export async function installOrRestore({ runtime, key, install, onRestored, store }: {
  runtime: () => Promise<SnapshotRuntime>;
  key: string | null;
  install: () => Promise<number>;
  onRestored?: () => void;
  store?: SnapshotStore | null;
}): Promise<number> {
  if (!key) return install();
  let booted: SnapshotRuntime | null = null;
  try {
    booted = await runtime();
  } catch {
    return install();
  }
  if (await restoreInstalledPackages(booted, key, store)) {
    onRestored?.();
    return 0;
  }
  const code = await install();
  // Never awaited: the dev server must not wait on IndexedDB.
  if (code === 0) void saveInstalledPackages(booted, key, store);
  return code;
}
