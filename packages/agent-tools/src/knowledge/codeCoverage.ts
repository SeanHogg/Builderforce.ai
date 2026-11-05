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
import type { KnowledgeFs } from './fsDirectorySource.js';
import { slashPath } from './rootRelative.js';

/** Where coverage is looked for: the root and its sub-folders down to this depth. */
const MAX_DEPTH = 4;
const MAX_DIRS = 4_000;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
const COVERAGE_FILES = ['coverage-final.json', 'lcov.info'] as const;

export type CoverageSourceState = 'collected' | 'absent';

/** The folder under review, as the reads need it. */
export interface CoverageRoot {
    fs: KnowledgeFs;
    /** Absolute path of the reviewed root. */
    rootPath: string;
}

/** What was left out of the coverage badges, and why. */
export interface CoverageSkip {
    path: string;
    reason: 'too-large' | 'stale';
}

export interface CoverageReport {
    /** Line coverage (0..1) per root-relative file. */
    values: Map<string, number>;
    skipped: CoverageSkip[];
}

/** A Windows-style root (`C:/…`) compares case-insensitively; a POSIX one does not. */
const caseInsensitive = (root: string): boolean => /^[A-Za-z]:/.test(root);

/** `file` (absolute, or relative to the folder `baseRel` holds the coverage for) as a root-relative path; undefined when it lies outside the root. */
export function coveragePathOf(file: string, rootPath: string, baseRel: string): string | undefined {
    const f = slashPath(file);
    const root = slashPath(rootPath);
    const absolute = /^([A-Za-z]:)?\//.test(f);
    let rel: string;
    if (absolute) {
        const fold = caseInsensitive(root) ? (s: string): string => s.toLowerCase() : (s: string): string => s;
        if (fold(f) !== fold(root) && !fold(f).startsWith(`${fold(root)}/`)) return undefined;
        rel = f.slice(root.length + 1);
    } else {
        rel = baseRel ? `${baseRel}/${f}` : f;
    }
    const parts: string[] = [];
    for (const part of rel.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') { if (parts.pop() === undefined) return undefined; continue; }
        parts.push(part);
    }
    return parts.length > 0 ? parts.join('/') : undefined;
}

const ratio = (covered: number, total: number): number => Math.round((covered / total) * 1e4) / 1e4;

interface IstanbulFile {
    path?: string;
    statementMap?: Record<string, { start?: { line?: number } }>;
    s?: Record<string, number>;
    l?: Record<string, number>;
}

/** Line coverage per file of an istanbul `coverage-final.json`. */
export function parseIstanbul(json: string, rootPath: string, baseRel: string): Map<string, number> {
    const out = new Map<string, number>();
    let data: unknown;
    try { data = JSON.parse(json); } catch { return out; }
    if (!data || typeof data !== 'object') return out;
    for (const [key, raw] of Object.entries(data as Record<string, IstanbulFile>)) {
        const path = coveragePathOf(raw?.path ?? key, rootPath, baseRel);
        if (!path || !raw) continue;
        const lines = new Map<number, boolean>();
        if (raw.l) {
            for (const [line, hits] of Object.entries(raw.l)) lines.set(Number(line), hits > 0);
        } else if (raw.statementMap && raw.s) {
            for (const [id, loc] of Object.entries(raw.statementMap)) {
                const line = loc?.start?.line;
                if (typeof line === 'number') lines.set(line, (lines.get(line) ?? false) || (raw.s[id] ?? 0) > 0);
            }
        }
        if (lines.size > 0) out.set(path, ratio([...lines.values()].filter(Boolean).length, lines.size));
    }
    return out;
}

/** Line coverage per file of an `lcov.info` (`DA:` lines, else `LH` / `LF`). */
export function parseLcov(text: string, rootPath: string, baseRel: string): Map<string, number> {
    const out = new Map<string, number>();
    let file: string | undefined;
    let found = 0, hit = 0, da = 0, daHit = 0;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith('SF:')) {
            file = coveragePathOf(line.slice(3), rootPath, baseRel);
            found = hit = da = daHit = 0;
        } else if (line.startsWith('DA:')) {
            da++;
            if (Number(line.slice(3).split(',')[1]) > 0) daHit++;
        } else if (line.startsWith('LF:')) found = Number(line.slice(3)) || 0;
        else if (line.startsWith('LH:')) hit = Number(line.slice(3)) || 0;
        else if (line === 'end_of_record') {
            const total = da > 0 ? da : found;
            if (file && total > 0) out.set(file, ratio(da > 0 ? daHit : hit, total));
            file = undefined;
        }
    }
    return out;
}

/** Folders (root-relative) that hold a `coverage` folder, breadth-first, bounded. */
async function coverageFolders(root: CoverageRoot): Promise<string[]> {
    const base = slashPath(root.rootPath);
    const found: string[] = [];
    const queue: Array<{ dir: string; depth: number }> = [{ dir: '', depth: 0 }];
    let visited = 0;
    while (queue.length > 0 && visited++ < MAX_DIRS) {
        const { dir, depth } = queue.shift()!;
        let entries: Array<[string, 'file' | 'dir']>;
        try { entries = await root.fs.readDirectory(dir ? `${base}/${dir}` : base); } catch { continue; }
        for (const [name, kind] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
            if (kind !== 'dir') continue;
            const rel = dir ? `${dir}/${name}` : name;
            if (name === 'coverage') found.push(rel);
            else if (depth + 1 < MAX_DEPTH && !name.startsWith('.') && !isSkippedDirName(name)) queue.push({ dir: rel, depth: depth + 1 });
        }
    }
    return found;
}

interface CoverageFile {
    text: string;
    mtime: number;
}

/** A coverage file's text and mtime; undefined when absent, unreadable or over the cap (the latter is reported). */
async function readCoverageFile(root: CoverageRoot, rel: string, skipped: CoverageSkip[]): Promise<CoverageFile | undefined> {
    const abs = `${slashPath(root.rootPath)}/${rel}`;
    try {
        const stat = await root.fs.stat(abs);
        if (stat.size > MAX_FILE_BYTES) { skipped.push({ path: rel, reason: 'too-large' }); return undefined; }
        return { text: new TextDecoder('utf-8').decode(await root.fs.readFile(abs)), mtime: stat.mtime };
    } catch { return undefined; }
}

/**
 * Line coverage (0..1) per root-relative file, from every coverage folder under the root.
 * When both formats list a file the istanbul figure wins; between folders the later
 * (alphabetical) one wins. Files edited after their coverage was written are left out and
 * reported as `stale`.
 */
export async function readCoverage(root: CoverageRoot): Promise<CoverageReport> {
    const values = new Map<string, number>();
    const writtenAt = new Map<string, number>();
    const skipped: CoverageSkip[] = [];
    for (const folder of await coverageFolders(root)) {
        const baseRel = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
        const lcov = await readCoverageFile(root, `${folder}/${COVERAGE_FILES[1]}`, skipped);
        const istanbul = await readCoverageFile(root, `${folder}/${COVERAGE_FILES[0]}`, skipped);
        for (const [file, parse] of [[lcov, parseLcov], [istanbul, parseIstanbul]] as const) {
            if (!file) continue;
            for (const [path, value] of parse(file.text, root.rootPath, baseRel)) {
                values.set(path, value);
                writtenAt.set(path, file.mtime);
            }
        }
    }
    const base = slashPath(root.rootPath);
    for (const [path, mtime] of writtenAt) {
        const source = await root.fs.stat(`${base}/${path}`).catch(() => undefined);
        if (source && source.mtime > mtime) { values.delete(path); skipped.push({ path, reason: 'stale' }); }
    }
    return { values, skipped };
}

/** `collected` when the root has usable coverage, else `absent` (the sync panel shows which). */
export async function coverageSourceState(root: CoverageRoot): Promise<CoverageSourceState> {
    return (await readCoverage(root)).values.size > 0 ? 'collected' : 'absent';
}
