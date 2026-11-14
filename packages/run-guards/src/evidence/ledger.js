/**
 * Evidence ledger (PRD 45 §4.2) — the pure half of the deterministic run gates.
 *
 * Evidence is a host fact keyed by the BYTES ON DISK. The ledger never hashes
 * anything itself (pure: no I/O, no clock — callers pass `at`) and never accepts
 * model prose: the only way a check lands here is the host calling `record` with
 * the content hash the host computed. A model's transcript line
 * `npx tsc | grep | head; echo DONE` has no path into this module — and even a
 * forged CheckRecord is useless, because the gate looks evidence up by the hash
 * of the file's real bytes, which the model does not control.
 *
 * Keys are normalised through {@link normalizeEvidencePath}: backslashes become
 * forward slashes so a Windows absolute path and a repo-relative path for the
 * same file share one entry. Hosts that want repo-relative display paths
 * (FileEvidence.path) simply pass repo-relative keys; the module echoes them.
 *
 * Rules:
 * - `record` for a non-latest hash is DROPPED — a stale check finishing late,
 *   after the file was rewritten, must never bless the new bytes.
 * - `noteWrite` drops evidence for older hashes of the path. Correctness never
 *   depends on it: the gate hashes the bytes at gate time and asks `for(hash)`,
 *   so a forgotten `noteWrite` only leaves memory that a lookup then misses.
 * - Lifetime is one run; `snapshot`/`createEvidenceLedger(resume)` exist so a
 *   host persisting between steps (the cloud durable loop) can carry it.
 */
/** A check's findings are capped at this many lines (PRD §4.2). */
export const MAX_CHECK_FINDINGS = 20;
/** A check's carried output tail is capped at this many chars — bounded, never unbounded. */
export const MAX_CHECK_OUTPUT_TAIL = 2048;
/** One normalisation helper for every key, per PRD §4.2 ("normalise both through one helper"). */
export function normalizeEvidencePath(path) {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}
export function createEvidenceLedger(resume) {
    const entries = new Map();
    if (resume) {
        for (const ev of resume) {
            entries.set(normalizeEvidencePath(ev.path), {
                latestHash: ev.contentHash,
                byHash: new Map([[ev.contentHash, [...ev.checks]]]),
            });
        }
    }
    const entryFor = (path) => {
        const key = normalizeEvidencePath(path);
        let e = entries.get(key);
        if (!e) {
            e = { latestHash: null, byHash: new Map() };
            entries.set(key, e);
        }
        return e;
    };
    return {
        noteWrite(path) {
            const e = entryFor(path);
            // The bytes changed; nothing recorded before can speak for them. Memory only —
            // a gate that hashes the file fresh would miss the stale entry either way.
            e.latestHash = null;
            e.byHash.clear();
        },
        record(path, contentHash, check) {
            const e = entryFor(path);
            // Stale check finishing late: the file has moved on since the host hashed it.
            if (e.latestHash !== null && e.latestHash !== contentHash)
                return;
            e.latestHash = contentHash;
            const capped = {
                ...check,
                findings: check.findings.slice(0, MAX_CHECK_FINDINGS),
                ...(check.outputTail ? { outputTail: check.outputTail.slice(-MAX_CHECK_OUTPUT_TAIL) } : {}),
            };
            const list = e.byHash.get(contentHash);
            if (list)
                list.push(capped);
            else
                e.byHash.set(contentHash, [capped]);
        },
        for(path, contentHash) {
            const e = entries.get(normalizeEvidencePath(path));
            if (!e || e.latestHash !== contentHash)
                return [];
            return e.byHash.get(contentHash) ?? [];
        },
        current(path) {
            const key = normalizeEvidencePath(path);
            const e = entries.get(key);
            if (!e || e.latestHash === null)
                return null;
            return { path: key, contentHash: e.latestHash, checks: e.byHash.get(e.latestHash) ?? [] };
        },
        snapshot() {
            const out = [];
            for (const [key, e] of entries) {
                if (e.latestHash === null)
                    continue;
                out.push({ path: key, contentHash: e.latestHash, checks: e.byHash.get(e.latestHash) ?? [] });
            }
            return out;
        },
    };
}
//# sourceMappingURL=ledger.js.map