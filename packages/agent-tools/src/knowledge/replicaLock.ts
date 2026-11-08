/**
 * The replica pump's lock (PRD 41 A7): two hosts on one root share ONE queue file, and only the
 * host holding `<root>.replica.lock` pumps it. The lock holds `{ pid, at }` (`pid` is the owner: a process id, or a random
 * id where there is no process, e.g. a browser tab), is refreshed every 30 s while held, and is stale after 2 minutes (a
 * crashed host never blocks the other). Pure over {@link KnowledgeFiles}; a read-after-write check settles two hosts racing.
 */

import { replicaFileName, type KnowledgeFiles } from './fileManifest.js';

export const LOCK_REFRESH_MS = 30_000;
export const LOCK_STALE_MS = 120_000;

export const lockFileName = (rootId: string): string => replicaFileName(rootId).replace(/\.json$/, '.lock');

type Owner = string | number;
interface LockRecord { pid: Owner; at: number }

function parse(text: string | undefined): LockRecord | undefined {
    if (!text) return undefined;
    try {
        const v = JSON.parse(text) as Partial<LockRecord>;
        return (typeof v.pid === 'number' || typeof v.pid === 'string') && typeof v.at === 'number' ? { pid: v.pid, at: v.at } : undefined;
    } catch {
        return undefined;
    }
}

export interface ReplicaLock { release(): Promise<void> }

/** Who holds the lock when the caller names no owner: the process id where there is one, else an id made once. */
function defaultOwner(): Owner {
    const pid = (globalThis as { process?: { pid?: unknown } }).process?.pid;
    return typeof pid === 'number' ? pid : globalThis.crypto.randomUUID();
}

/** The lock for `rootId`, or undefined when another live holder has it. */
export async function acquireReplicaLock(
    files: KnowledgeFiles,
    rootId: string,
    opts: { pid?: Owner; now?: () => number } = {},
): Promise<ReplicaLock | undefined> {
    const pid = opts.pid ?? defaultOwner();
    const now = opts.now ?? Date.now;
    const name = lockFileName(rootId);
    const held = parse(await files.read(name).catch(() => undefined));
    if (held && held.pid !== pid && held.at > 0 && now() - held.at < LOCK_STALE_MS) return undefined;
    const stamp = async (at: number): Promise<void> => { await files.write(name, JSON.stringify({ pid, at })); };
    const mine = now();
    await stamp(mine);
    const check = parse(await files.read(name).catch(() => undefined));
    if (!check || check.pid !== pid) return undefined;
    const timer = setInterval(() => { void stamp(now()).catch(() => undefined); }, LOCK_REFRESH_MS);
    (timer as { unref?: () => void }).unref?.();
    return {
        async release() {
            clearInterval(timer);
            await stamp(0).catch(() => undefined);
        },
    };
}

/** What the replica host asks for a lock: `undefined` when another live holder has the root. */
export interface ReplicaLockPort {
    acquire(files: KnowledgeFiles, rootId: string): Promise<ReplicaLock | undefined>;
}

/** The file-backed lock, one owner per instance (default: the process id, else a random id made once). */
export function fileReplicaLock(opts: { owner?: Owner; now?: () => number } = {}): ReplicaLockPort {
    const pid = opts.owner ?? defaultOwner();
    return { acquire: (files, rootId) => acquireReplicaLock(files, rootId, { pid, ...(opts.now ? { now: opts.now } : {}) }) };
}
