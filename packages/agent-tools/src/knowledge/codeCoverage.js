/**
 * knowledge/codeCoverage.ts — line coverage found under the reviewed root, as the
 * `coverage` badge (PRD 38, Option B+ Contract 1, provenance `runtime`).
 *
 * Reads what a test run already left behind — istanbul's `coverage/coverage-final.json`
 * and `coverage/lcov.info`, in the root's own `coverage/` and in per-package ones — and
 * maps every file to a root-relative path with a 0..1 line coverage. It never runs tests
 * and never estimates: no file, no badge. A file edited AFTER its coverage was written has
 * no badge either (its numbers describe other code) and is reported as `stale`; a coverage
 * file over {@link MAX_FILE_BYTES} is not read and is reported as `too-large`. Reads go
 * through the review's {@link KnowledgeFs} (the `coverage` folder is on the walk's skip
 * list, so the source never lists it).
 */
import { isSkippedDirName } from '../skipDirs.js';
import { slashPath } from './rootRelative.js';
/** Where coverage is looked for: the root and its sub-folders down to this depth. */
const MAX_DEPTH = 4;
const MAX_DIRS = 4_000;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
const COVERAGE_FILES = ['coverage-final.json', 'lcov.info'];
/** A Windows-style root (`C:/…`) compares case-insensitively; a POSIX one does not. */
const caseInsensitive = (root) => /^[A-Za-z]:/.test(root);
/** `file` (absolute, or relative to the folder `baseRel` holds the coverage for) as a root-relative path; undefined when it lies outside the root. */
export function coveragePathOf(file, rootPath, baseRel) {
    const f = slashPath(file);
    const root = slashPath(rootPath);
    const absolute = /^([A-Za-z]:)?\//.test(f);
    let rel;
    if (absolute) {
        const fold = caseInsensitive(root) ? (s) => s.toLowerCase() : (s) => s;
        if (fold(f) !== fold(root) && !fold(f).startsWith(`${fold(root)}/`))
            return undefined;
        rel = f.slice(root.length + 1);
    }
    else {
        rel = baseRel ? `${baseRel}/${f}` : f;
    }
    const parts = [];
    for (const part of rel.split('/')) {
        if (!part || part === '.')
            continue;
        if (part === '..') {
            if (parts.pop() === undefined)
                return undefined;
            continue;
        }
        parts.push(part);
    }
    return parts.length > 0 ? parts.join('/') : undefined;
}
const ratio = (covered, total) => Math.round((covered / total) * 1e4) / 1e4;
/** Executed lines per file of an istanbul `coverage-final.json` (its `l` map, else statement starts). */
export function istanbulLineHits(json, rootPath, baseRel) {
    const out = new Map();
    let data;
    try {
        data = JSON.parse(json);
    }
    catch {
        return out;
    }
    if (!data || typeof data !== 'object')
        return out;
    for (const [key, raw] of Object.entries(data)) {
        const path = coveragePathOf(raw?.path ?? key, rootPath, baseRel);
        if (!path || !raw)
            continue;
        const lines = new Map();
        if (raw.l) {
            for (const [line, hits] of Object.entries(raw.l))
                lines.set(Number(line), hits > 0);
        }
        else if (raw.statementMap && raw.s) {
            for (const [id, loc] of Object.entries(raw.statementMap)) {
                const line = loc?.start?.line;
                if (typeof line === 'number')
                    lines.set(line, (lines.get(line) ?? false) || (raw.s[id] ?? 0) > 0);
            }
        }
        if (lines.size > 0)
            out.set(path, lines);
    }
    return out;
}
/** Line coverage per file of an istanbul `coverage-final.json`. */
export function parseIstanbul(json, rootPath, baseRel) {
    const out = new Map();
    for (const [path, lines] of istanbulLineHits(json, rootPath, baseRel))
        out.set(path, ratio([...lines.values()].filter(Boolean).length, lines.size));
    return out;
}
/** Every record of an `lcov.info`, in order. */
function lcovRecords(text, rootPath, baseRel) {
    const out = [];
    let rec = { file: undefined, lines: new Map(), das: 0, daHits: 0, found: 0, hit: 0 };
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith('SF:')) {
            rec = { file: coveragePathOf(line.slice(3), rootPath, baseRel), lines: new Map(), das: 0, daHits: 0, found: 0, hit: 0 };
        }
        else if (line.startsWith('DA:')) {
            const [n, count] = line.slice(3).split(',');
            const executed = Number(count) > 0;
            rec.das++;
            if (executed)
                rec.daHits++;
            const ln = Number(n);
            if (Number.isInteger(ln) && ln > 0)
                rec.lines.set(ln, (rec.lines.get(ln) ?? false) || executed);
        }
        else if (line.startsWith('LF:'))
            rec.found = Number(line.slice(3)) || 0;
        else if (line.startsWith('LH:'))
            rec.hit = Number(line.slice(3)) || 0;
        else if (line === 'end_of_record') {
            out.push(rec);
            rec = { file: undefined, lines: new Map(), das: 0, daHits: 0, found: 0, hit: 0 };
        }
    }
    return out;
}
/** Executed lines per file of an `lcov.info` (`DA:` lines). */
export function lcovLineHits(text, rootPath, baseRel) {
    const out = new Map();
    for (const r of lcovRecords(text, rootPath, baseRel))
        if (r.file && r.lines.size > 0)
            out.set(r.file, r.lines);
    return out;
}
/** Line coverage per file of an `lcov.info` (`DA:` lines, else `LH` / `LF`). */
export function parseLcov(text, rootPath, baseRel) {
    const out = new Map();
    for (const r of lcovRecords(text, rootPath, baseRel)) {
        const total = r.das > 0 ? r.das : r.found;
        if (r.file && total > 0)
            out.set(r.file, ratio(r.das > 0 ? r.daHits : r.hit, total));
    }
    return out;
}
/** Folders (root-relative) that hold a `coverage` folder, breadth-first, bounded. */
async function coverageFolders(root) {
    const base = slashPath(root.rootPath);
    const found = [];
    const queue = [{ dir: '', depth: 0 }];
    let visited = 0;
    while (queue.length > 0 && visited++ < MAX_DIRS) {
        const { dir, depth } = queue.shift();
        let entries;
        try {
            entries = await root.fs.readDirectory(dir ? `${base}/${dir}` : base);
        }
        catch {
            continue;
        }
        for (const [name, kind] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
            if (kind !== 'dir')
                continue;
            const rel = dir ? `${dir}/${name}` : name;
            if (name === 'coverage')
                found.push(rel);
            else if (depth + 1 < MAX_DEPTH && !name.startsWith('.') && !isSkippedDirName(name))
                queue.push({ dir: rel, depth: depth + 1 });
        }
    }
    return found;
}
/** A coverage file's text and mtime; undefined when absent, unreadable or over the cap (the latter is reported). */
async function readCoverageFile(root, rel, skipped) {
    const abs = `${slashPath(root.rootPath)}/${rel}`;
    try {
        const stat = await root.fs.stat(abs);
        if (stat.size > MAX_FILE_BYTES) {
            skipped.push({ path: rel, reason: 'too-large' });
            return undefined;
        }
        return { text: new TextDecoder('utf-8').decode(await root.fs.readFile(abs)), mtime: stat.mtime };
    }
    catch {
        return undefined;
    }
}
/**
 * Line coverage (0..1) per root-relative file, from every coverage folder under the root.
 * When both formats list a file the istanbul figure wins; between folders the later
 * (alphabetical) one wins. Files edited after their coverage was written are left out and
 * reported as `stale`.
 */
export async function readCoverage(root) {
    const values = new Map();
    const writtenAt = new Map();
    const skipped = [];
    for (const folder of await coverageFolders(root)) {
        const baseRel = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
        const lcov = await readCoverageFile(root, `${folder}/${COVERAGE_FILES[1]}`, skipped);
        const istanbul = await readCoverageFile(root, `${folder}/${COVERAGE_FILES[0]}`, skipped);
        for (const [file, parse] of [[lcov, parseLcov], [istanbul, parseIstanbul]]) {
            if (!file)
                continue;
            for (const [path, value] of parse(file.text, root.rootPath, baseRel)) {
                values.set(path, value);
                writtenAt.set(path, file.mtime);
            }
        }
    }
    const base = slashPath(root.rootPath);
    for (const [path, mtime] of writtenAt) {
        const source = await root.fs.stat(`${base}/${path}`).catch(() => undefined);
        if (source && source.mtime > mtime) {
            values.delete(path);
            skipped.push({ path, reason: 'stale' });
        }
    }
    return { values, skipped };
}
/** `collected` when the root has usable coverage, else `absent` (the sync panel shows which). */
export async function coverageSourceState(root) {
    return (await readCoverage(root)).values.size > 0 ? 'collected' : 'absent';
}
//# sourceMappingURL=codeCoverage.js.map