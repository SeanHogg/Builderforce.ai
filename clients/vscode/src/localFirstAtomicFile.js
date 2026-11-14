/**
 * The write-temp / fsync / rename-over steps every journal rewrite shares (G03): the compaction
 * stream, the import and rebuild `compact`, and the snapshot cache. One owner for the temp
 * name, the whole-write check, the Windows rename retry and the directory fsync.
 */
import nodeFs from "node:fs";
import nodePath from "node:path";
const fs = nodeFs.promises;
/** A unique sibling temp name for `target`: `<target>.<pid>.<ms>.<base36>.tmp` (what orphan cleanup matches). */
export const temporaryPathFor = (target) => `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
/** A write the file system cut short is a failed write: publishing it would leave a damaged frame or base. */
export async function writeWhole(handle, frame, position) {
    const { bytesWritten } = await handle.write(frame, 0, frame.byteLength, position);
    if (bytesWritten !== frame.byteLength) {
        throw new Error(`local_first_short_write: wrote ${bytesWritten} of ${frame.byteLength} bytes`);
    }
}
/**
 * Write `frames` to a NEW file at `path`, fsynced before it returns. On any failure the file is
 * removed. Never holds more than one frame in memory.
 */
export async function writeFrameFile(path, frames) {
    let bytes = 0;
    let count = 0;
    try {
        const handle = await fs.open(path, "wx");
        try {
            for await (const frame of frames) {
                await writeWhole(handle, frame, bytes);
                bytes += frame.byteLength;
                count += 1;
            }
            // Crash-safety: the data must be durable before a rename can ever publish it.
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    catch (error) {
        await fs.rm(path, { force: true });
        throw error;
    }
    return { bytes, frames: count };
}
/** Errors a rename over a file another process has open raises on Windows (antivirus, an indexer, a reader). */
const TRANSIENT_RENAME = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_RETRY_DELAYS_MS = [20, 40, 80, 160];
/**
 * Rename `from` over `to` and make the new directory entry durable. A transient Windows
 * sharing error is retried (5 tries, about 300 ms in all); any other error, or the last one,
 * is thrown with `from` still in place for the caller to remove. The directory fsync is best
 * effort: Windows cannot open a directory and that is not a failure.
 */
export async function renameDurably(from, to) {
    for (let attempt = 0;; attempt += 1) {
        try {
            await fs.rename(from, to);
            break;
        }
        catch (error) {
            const delay = RENAME_RETRY_DELAYS_MS[attempt];
            if (delay === undefined || !TRANSIENT_RENAME.has(error.code ?? ""))
                throw error;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    await fs.open(nodePath.dirname(to), "r").then(async (directory) => {
        try {
            await directory.sync();
        }
        finally {
            await directory.close();
        }
    }).catch(() => undefined);
}
//# sourceMappingURL=localFirstAtomicFile.js.map