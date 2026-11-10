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
 * one host can create the file, and a stale or released lock is first moved aside (best effort) — the exclusive create, never
 * the rename, decides the winner of a takeover. Without it the lock falls back to write-then-verify; two hosts racing that window are settled by the first refresh,
 * which the loser sees as a lost lock.
 */

import { replicaFileName, type KnowledgeFiles } from './fileManifest.js';

export const LOCK_REFRESH_MS = 30_000;
export const LOCK_STALE_MS = 120_000;
/** A holder whose last successful stamp is older than this counts its lock as lost: one refresh short of stale, so it stops before another host can take over. */
export const LOCK_FRESH_MS = LOCK_STALE_MS - LOCK_REFRESH_MS;

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
    /** Aborted when a refresh found the lock taken by another owner (or its stamp went stale): the holder must stop pumping. Absent for a lock that cannot be lost (Web Locks). */
    readonly lost?: AbortSignal;
    /** Whether the last successful stamp is still fresh enough that no other host can have taken over: asked before each send (aborts `lost` when not). */
    isFresh?(): boolean;
}

/**
 * Who holds the lock when the caller names no owner: a per-INSTANCE id (the process id plus a random nonce), so two hosts in
 * one process (two replica hosts, an extension host and its worker) never read each other's lock as their own.
 */
function defaultOwner(): Owner {
    const pid = (globalThis as { process?: { pid?: unknown } }).process?.pid;
    // Typed structurally: the api's lib has no WebCrypto global; node and browsers do.
    const nonce = (globalThis as { crypto?: { randomUUID?(): string } }).crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    return typeof pid === 'number' ? `${pid}-${nonce}` : `tab-${nonce}`;
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
 * corrupt or this owner's), move it aside (best effort) and create again. Only the exclusive create decides who holds it,
 * on every path: the takeover's rename may succeed for several hosts at once (Windows), and a host that loses the create backs off.
 */
async function takeExclusive(files: ReplicaLockFiles, name: string, pid: Owner, at: number): Promise<boolean> {
    const create = files.createExclusive!.bind(files);
    const text = JSON.stringify({ pid, at });
    if (await create(name, text).catch(() => false)) return true;
    const seen = await readLock(files, name);
    if (!seen.ok || liveOther(parse(seen.text), pid, at)) return false;
    if (files.rename) {
        // Best effort only: on Windows two hosts renaming the same file can BOTH succeed, so the rename decides nothing.
        // The exclusive create below is the only arbiter; a host that loses it backs off.
        const aside = `${name}.${String(pid)}-${at.toString(36)}.taken`;
        const again = await readLock(files, name);
        if (!again.ok || liveOther(parse(again.text), pid, at)) return false; // a fresh lock appeared meanwhile: never move it
        await files.rename(name, aside).catch(() => undefined);
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
    /** The lock is lost once its last SUCCESSFUL stamp is old enough that another host may already have taken it (a stall). */
    const fresh = (): boolean => {
        if (lost.signal.aborted) return false;
        if (now() - stamp < LOCK_FRESH_MS) return true;
        stop(); lost.abort();
        return false;
    };
    let busy = false;
    const refresh = async (): Promise<void> => {
        if (busy || lost.signal.aborted) return;
        busy = true;
        try {
            // After a stall a check-then-write could pass the check and stamp over a host that took over in between: never rewrite.
            if (!fresh()) return;
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
        isFresh: fresh,
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

/** The file-backed lock, one owner per instance (default: the process id plus a random nonce, made once per instance). */
export function fileReplicaLock(opts: { owner?: Owner; now?: () => number } = {}): ReplicaLockPort {
    const pid = opts.owner ?? defaultOwner();
    return { acquire: (files, rootId) => acquireReplicaLock(files, rootId, { pid, ...(opts.now ? { now: opts.now } : {}) }) };
}
