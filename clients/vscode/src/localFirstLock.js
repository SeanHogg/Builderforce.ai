/**
 * The VSIX store's cross-process file lock (`local-first-v1.lock`, G26).
 *
 * Every VS Code window runs its own extension host over the SAME global
 * storage, so a commit takes this lock. Two rules, and they used to fight:
 *
 *   - NEVER STEAL FROM A LIVE HOLDER. A held lock is busy however old it is
 *     (`leaseBusy`); a contender polls for `LOCAL_FIRST_BUSY_TIMEOUT_MS` (an open:
 *     `LOCAL_FIRST_OPEN_BUSY_TIMEOUT_MS`) and then fails `local_first_store_busy`. There is no age window.
 *   - NEVER BRICK. A holder that crashed mid-commit used to leave its lock
 *     behind forever, and a failed write right after the exclusive create left
 *     a lock naming nobody that was ALSO busy forever. A dead holder is now
 *     reclaimed — on proof of death (`leaseReclaimable`), never on age:
 *       · the lock names its holder's pid, host, and process start;
 *       · a pid that no longer exists (`ESRCH`) is dead;
 *       · our own pid with a different process start is a previous process
 *         that happened to get the same pid — dead;
 *       · our own process, with no live holder of that id here — a commit that
 *         threw before releasing — dead;
 *       · a lock with no readable holder is a create that never finished: the
 *         lock is created by hard-linking a fully written file, so a live
 *         holder's lock is never seen empty;
 *       · another machine, or a live pid, is NOT dead: busy.
 *
 * Reclaim is rename-then-verify, so two contenders reclaiming the same dead
 * lock cannot delete a fresh holder's lock: the one that moves a lock it did
 * not judge puts it back without overwriting. Release removes the lock only
 * while it still names this owner.
 *
 * Imports `node:` modules and the shared contract only — no `vscode`.
 */
import nodeFs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { leaseBusy, leaseReclaimable } from "@builderforce/local-first";
const fs = nodeFs.promises;
/**
 * How long a second owner polls before `local_first_store_busy` when it wants to COMMIT.
 * Sized past the longest ordinary hold (a compaction measured at 2.7 s on a fast disk).
 * Not a steal window: a lock older than 30s is still the holder's.
 */
export const LOCAL_FIRST_BUSY_TIMEOUT_MS = 15_000;
/** The same wait for an OPEN (the one-time import measured at about 3.3 s, far more on a slow disk). */
export const LOCAL_FIRST_OPEN_BUSY_TIMEOUT_MS = 60_000;
/** Pause between exclusive attempts while another owner holds the lock. */
export const LOCAL_FIRST_BUSY_POLL_MS = 25;
/** Two start stamps this close are the same process start (the stamp is derived from uptime). */
const START_IDENTITY_TOLERANCE_MS = 1_000;
export const THIS_HOST = Object.freeze({
    pid: process.pid,
    startedAt: Math.round(Date.now() - process.uptime() * 1000),
    host: os.hostname(),
});
/** Owners holding a lock in THIS process. Realm-global so a second copy of this module sees the same set. */
const HOLDING_KEY = Symbol.for("builderforce.localFirst.lockHolders");
function holdersInThisProcess() {
    const realm = globalThis;
    realm[HOLDING_KEY] ??= new Set();
    return realm[HOLDING_KEY];
}
const holdingHere = holdersInThisProcess();
/** `process.kill(pid, 0)`: ESRCH is dead, EPERM is alive (exists, not ours), anything else unknown. */
export function processLiveness(pid) {
    try {
        process.kill(pid, 0);
        return "alive";
    }
    catch (error) {
        const code = error.code;
        if (code === "ESRCH")
            return "dead";
        if (code === "EPERM")
            return "alive";
        return "unknown";
    }
}
/** What this process can prove about the holder named in a lock file. */
export function lockHolderLiveness(lease, self = THIS_HOST, probe = processLiveness, holdsHere = (holder) => holdingHere.has(holder)) {
    if (!leaseBusy(lease.holder))
        return "dead";
    if (typeof lease.pid !== "number") {
        // A lock from a build that wrote no identity. Such a build held the lock for
        // one commit; one written before this process existed has no live writer.
        return typeof lease.heldSince === "number" && lease.heldSince < self.startedAt ? "dead" : "unknown";
    }
    if (lease.host !== undefined && lease.host !== self.host)
        return "unknown";
    if (lease.pid === self.pid) {
        const sameStart = typeof lease.hostStartedAt === "number"
            && Math.abs(lease.hostStartedAt - self.startedAt) <= START_IDENTITY_TOLERANCE_MS;
        if (!sameStart)
            return "dead";
        return holdsHere(lease.holder) ? "alive" : "dead";
    }
    return probe(lease.pid);
}
/** `undefined` when the lock is gone or momentarily unreadable (Windows delete-pending). */
async function readLock(lockPath) {
    let text;
    try {
        text = await fs.readFile(lockPath, "utf8");
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOENT" || code === "EBUSY" || code === "EPERM" || code === "EACCES")
            return undefined;
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        // Empty or torn: a create that never finished naming its holder.
        return { holder: null };
    }
    return {
        holder: typeof parsed?.holder === "string" && parsed.holder.length > 0 ? parsed.holder : null,
        ...(typeof parsed?.pid === "number" ? { pid: parsed.pid } : {}),
        ...(typeof parsed?.hostStartedAt === "number" ? { hostStartedAt: parsed.hostStartedAt } : {}),
        ...(typeof parsed?.host === "string" ? { host: parsed.host } : {}),
        ...(typeof parsed?.heldSince === "number" ? { heldSince: parsed.heldSince } : {}),
    };
}
function sameLease(a, b) {
    return !!a && a.holder === b.holder && a.pid === b.pid && a.heldSince === b.heldSince;
}
const LINK_UNSUPPORTED = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "ENOSYS", "EINVAL"]);
/** Exclusive create via `wx`, for file systems without hard links. Never leaves a nameless lock behind. */
async function createWithExclusiveOpen(lockPath, content) {
    let handle;
    try {
        handle = await fs.open(lockPath, "wx");
    }
    catch (error) {
        if (error.code === "EEXIST")
            return false;
        throw error;
    }
    try {
        await handle.writeFile(content);
    }
    catch (error) {
        await handle.close();
        // We created it and could not name ourselves in it: remove it, or it is busy forever.
        await fs.rm(lockPath, { force: true });
        throw error;
    }
    await handle.close();
    return true;
}
/**
 * Create the lock with its content already in place: write a private temp file,
 * then hard-link it to the lock name. `link` fails EEXIST when the lock exists,
 * and the lock is never visible without its holder.
 */
async function createLock(lockPath, content) {
    const temporary = `${lockPath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, { flag: "wx" });
    try {
        await fs.link(temporary, lockPath);
        return true;
    }
    catch (error) {
        const code = error.code ?? "";
        if (code === "EEXIST")
            return false;
        if (LINK_UNSUPPORTED.has(code))
            return createWithExclusiveOpen(lockPath, content);
        throw error;
    }
    finally {
        await fs.rm(temporary, { force: true });
    }
}
/**
 * Remove a dead lock without ever removing a fresh one: move it aside, check
 * the moved file is the one judged dead, and if a newer holder's lock was moved
 * instead, put it back (`link` never overwrites a lock created meanwhile).
 */
async function reclaimDeadLock(lockPath, dead) {
    const tomb = `${lockPath}.reclaimed-${randomUUID()}`;
    try {
        await fs.rename(lockPath, tomb);
    }
    catch (error) {
        const code = error.code;
        // Gone already (released or reclaimed by someone else), or busy on Windows: re-poll.
        if (code === "ENOENT" || code === "EBUSY" || code === "EPERM" || code === "EACCES")
            return;
        throw error;
    }
    try {
        if (sameLease(await readLock(tomb), dead))
            return;
        try {
            await fs.link(tomb, lockPath);
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
        }
    }
    finally {
        await fs.rm(tomb, { force: true });
    }
}
export function createLocalFirstFileLock(lockPath, options = {}) {
    const ownerId = randomUUID();
    const identity = options.identity ?? THIS_HOST;
    const probe = options.processLiveness ?? processLiveness;
    const busyTimeoutMs = options.busyTimeoutMs ?? LOCAL_FIRST_BUSY_TIMEOUT_MS;
    const now = options.now ?? Date.now;
    return {
        ownerId,
        async acquire(timeoutMs = busyTimeoutMs) {
            const deadline = Date.now() + timeoutMs;
            for (;;) {
                const content = JSON.stringify({
                    holder: ownerId,
                    pid: identity.pid,
                    hostStartedAt: identity.startedAt,
                    host: identity.host,
                    heldSince: now(),
                });
                if (await createLock(lockPath, content)) {
                    holdingHere.add(ownerId);
                    return;
                }
                const lease = await readLock(lockPath);
                if (lease && leaseReclaimable(lease.holder, lockHolderLiveness(lease, identity, probe))) {
                    await reclaimDeadLock(lockPath, lease);
                    continue;
                }
                // A live (or unknowable) holder, or a lock that vanished/locked between
                // attempts: poll until the deadline. Never remove it.
                if (Date.now() >= deadline)
                    throw new Error("local_first_store_busy");
                await new Promise((resolve) => setTimeout(resolve, LOCAL_FIRST_BUSY_POLL_MS));
            }
        },
        /** Only the holder releases, and only while the lock still names it. */
        async release() {
            try {
                const lease = await readLock(lockPath);
                if (lease?.holder === ownerId)
                    await fs.rm(lockPath, { force: true });
            }
            finally {
                // Last: until the file is gone a contender in this process must see us alive.
                holdingHere.delete(ownerId);
            }
        },
    };
}
//# sourceMappingURL=localFirstLock.js.map