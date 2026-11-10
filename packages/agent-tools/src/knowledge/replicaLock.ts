/**
 * The replica pump's lock (PRD 41 A7): two hosts on one root share ONE queue file, and only the
 * host holding `<root>.replica.lock` pumps it. The lock holds `{ pid, at }` (`pid` is the owner: a process id, or a random
 * id where there is no process, e.g. a browser tab), is refreshed every 30 s while held, and is stale after 2 minutes (a
 * crashed host never blocks the other). Pure over {@link KnowledgeFiles}.
 *
 * Ownership is the pair `(pid, at)` this holder last stamped — its owner token. A refresh or a release first reads the file
 * and touches it ONLY while it still names that token: a host that stalled past the stale window (a laptop asleep) and woke
 * after another host took the lock never stamps over it nor frees it. A refresh that finds the lock gone to another owner
 * aborts {@link ReplicaLock.lost}, and the holder stops pumping.
 *
 * Acquiring uses the files' exclusive create (`wx`, {@link ReplicaLockFiles.createExclusive}) when the host has one: only
 * one host can create the file, and a stale or released lock is first moved aside by an atomic rename that only one host can
 * win. Without it the lock falls back to write-then-verify; two hosts racing that window are settled by the first refresh,
 * which the loser sees as a lost lock.
 */

import { replicaFileName, type KnowledgeFiles } from './fileManifest.js';

export const LOCK_REFRESH_MS = 30_000;
export const LOCK_STALE_MS = 120_000;

export const lockFileName = (rootId: string): string => replicaFileName(rootId).replace(/\.json$/, '.lock');

type Owner = string | number;
interface LockRecord { pid: Owner; at: number }

/** The files a lock is kept in: {@link KnowledgeFiles}, plus the platform's exclusive create where the host has one. */
export interface ReplicaLockFiles extends KnowledgeFiles {
    /** Creates `name` with `text` only when it does not exist (`wx`): true when THIS call created it, false when it existed. */
    createExclusive?(name: string, text: string): Promise<boolean>;
}

function parse(text: string | undefined): LockRecord | undefined {
    if (!text) return undefined;
    try {
        const v = JSON.parse(text) as Partial<LockRecord>;
        return (typeof v.pid === 'number' || typeof v.pid === 'string') && typeof v.at === 'number' ? { pid: v.pid, at: v.at } : undefined;
    } catch {
        return undefined;
    }
}

export interface ReplicaLock {
    release(): Promise<void>;
    /** Aborted when a refresh found the lock taken by another owner: the holder must stop pumping. Absent for a lock that cannot be lost (Web Locks). */
    readonly lost?: AbortSignal;
}

/** Who holds the lock when the caller names no owner: the process id where there is one, else an id made once. */
function defaultOwner(): Owner {
    const pid = (globalThis as { process?: { pid?: unknown } }).process?.pid;
    if (typeof pid === 'number') return pid;
    // Typed structurally: the api's lib has no WebCrypto global; node and browsers do.
    const uuid = (globalThis as { crypto?: { randomUUID?(): string } }).crypto?.randomUUID?.();
    return uuid ?? `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Reads the lock file: `ok` false when the read itself failed (nothing can be concluded about the owner). */
async function readLock(files: KnowledgeFiles, name: string): Promise<{ ok: boolean; text: string | undefined }> {
    try { return { ok: true, text: await files.read(name) }; } catch { return { ok: false, text: undefined }; }
}

/** Whether `held` is another owner's live lock (fresh, not released). */
const liveOther = (held: LockRecord | undefined, pid: Owner, at: number): boolean =>
    !!held && held.pid !== pid && held.at > 0 && at - held.at < LOCK_STALE_MS;

/**
 * Takes the lock with the files' exclusive create: create it; else, when what is there is free to take (stale, released,
 * corrupt or this owner's), move it aside with ONE rename (a second host's rename of the same file fails) and create again.
 */
async function takeExclusive(files: ReplicaLockFiles, name: string, pid: Owner, at: number): Promise<boolean> {
    const create = files.createExclusive!.bind(files);
    const text = JSON.stringify({ pid, at });
    if (await create(name, text).catch(() => false)) return true;
    const seen = await readLock(files, name);
    if (!seen.ok || liveOther(parse(seen.text), pid, at)) return false;
    if (files.rename) {
        const aside = `${name}.${String(pid)}-${at.toString(36)}.taken`;
        try { await files.rename(name, aside); } catch { return false; } // another host moved it first
        const moved = await readLock(files, aside);
        await files.remove?.(aside).catch(() => undefined);
        // The rename raced a fresh create: what was moved is another owner's live lock, not the stale one. Put it back.
        if (moved.ok && moved.text !== seen.text && liveOther(parse(moved.text), pid, at)) {
            await create(name, moved.text!).catch(() => false);
            return false;
        }
    } else if (files.remove) {
        const again = await readLock(files, name);
        if (!again.ok || again.text !== seen.text) return false;
        await files.remove(name).catch(() => undefined);
    } else {
        return false;
    }
    return create(name, text).catch(() => false);
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
    const lockFiles = files as ReplicaLockFiles;
    const exclusive = typeof lockFiles.createExclusive === 'function';
    let stamp = now();

    if (exclusive) {
        if (!(await takeExclusive(lockFiles, name, pid, stamp))) return undefined;
    } else {
        const held = parse((await readLock(files, name)).text);
        if (liveOther(held, pid, stamp)) return undefined;
        await files.write(name, JSON.stringify({ pid, at: stamp }));
        const check = parse((await readLock(files, name)).text);
        if (!check || check.pid !== pid || check.at !== stamp) return undefined;
    }

    const lost = new AbortController();
    /** Whether the file still names this holder's token; undefined when the read failed. */
    const stillMine = async (): Promise<boolean | undefined> => {
        const seen = await readLock(files, name);
        if (!seen.ok) return undefined;
        const rec = parse(seen.text);
        return !!rec && rec.pid === pid && rec.at === stamp;
    };
    let busy = false;
    const refresh = async (): Promise<void> => {
        if (busy || lost.signal.aborted) return;
        busy = true;
        try {
            const mine = await stillMine();
            if (mine === undefined) return; // unreadable this tick: try again on the next
            if (!mine) { stop(); lost.abort(); return; }
            const next = now();
            await files.write(name, JSON.stringify({ pid, at: next }));
            stamp = next;
        } catch {
            /* a failed stamp is retried on the next tick */
        } finally {
            busy = false;
        }
    };
    const timer = setInterval(() => { void refresh(); }, LOCK_REFRESH_MS);
    (timer as { unref?: () => void }).unref?.();
    const stop = (): void => clearInterval(timer);
    return {
        lost: lost.signal,
        async release() {
            stop();
            if (lost.signal.aborted || (await stillMine()) !== true) return; // another owner's lock: never freed by this holder
            if (exclusive && files.remove) await files.remove(name).catch(() => undefined);
            else await files.write(name, JSON.stringify({ pid, at: 0 })).catch(() => undefined);
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
