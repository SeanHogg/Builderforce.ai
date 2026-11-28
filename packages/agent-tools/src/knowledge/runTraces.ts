/**
 * knowledge/runTraces.ts — recorded runs found under the reviewed root, the `traces` data
 * source of the Knowledge view (Server tab → DATA SOURCES).
 *
 * A run is one file, `<root>/.builderforce/traces/<run-id>.jsonl`; each line is one call
 * entered, in call order:
 *   `{ "run": string, "at": ISO-8601, "file": path, "fn"?, "line"?, "args"?, "ret"? }`
 * where `file` is root-relative, or absolute / a `file://` URL under the root (made
 * root-relative).
 *
 * Reads go through the review's {@link KnowledgeFs}. Nothing is invented: a line that is not
 * JSON, lacks its `run` / `at` / `file`, or names a file outside the root (absolute outside
 * it, or escaping with `..`) is dropped and counted in `skippedLines`. A directory that does
 * not exist is "no traces"; any other read error is thrown (directory) or handed to `report`
 * (one file), never swallowed.
 *
 * Bounded: at most {@link MAX_SCANNED_ENTRIES} directory entries are looked at, the newest
 * {@link MAX_TRACE_FILES} files are read, and at most {@link MAX_TOTAL_STEPS} steps are kept
 * (the rest are counted as skipped). A parsed file is memoised by (path, size, mtime), so a
 * repeated read of an unchanged file does not parse it again.
 */

import type { CoverageRoot } from './codeCoverage.js';
import { slashPath } from './rootRelative.js';

export const TRACE_DIR = '.builderforce/traces';
/** The newest this many trace files are read. */
export const MAX_TRACE_FILES = 20;
/** At most this many `.jsonl` entries of the trace folder are looked at (stat'ed) before the newest are picked. */
export const MAX_SCANNED_ENTRIES = 500;
/** A trace file over this is not read. */
export const MAX_TRACE_FILE_BYTES = 2 * 1024 * 1024;
/** Steps kept per run; the rest of its lines are counted as skipped. */
export const MAX_STEPS_PER_RUN = 5_000;
/** Steps kept across all files; the rest of the lines are counted as skipped. */
export const MAX_TOTAL_STEPS = 20_000;

export interface RunTraceStep { path: string; fn?: string; line?: number; args?: Record<string, string>; ret?: string }
export interface RunTrace { id: string; at: string; steps: RunTraceStep[] }
/** `runs` oldest first. */
export interface RunTraces { runs: RunTrace[]; skippedLines: number }

export type TraceSourceState = 'collected' | 'absent';

/** The `traces` row of the sync status. */
export interface TraceSourceRow {
    state: TraceSourceState;
    /** Recorded runs found (collected). */
    runs?: number;
    /** ISO time of the newest recorded run (collected). */
    latest?: string;
    /** Lines that were not valid steps: with `collected`, some were dropped; with `absent`, files exist but no run parsed. */
    unparsed?: number;
}

/** Why a trace file (or the folder) was not (fully) read; reported through `report`. */
export type TraceFileProblem = 'too-large' | 'unreadable' | 'too-many-files';

export type TraceReport = (file: string, problem: TraceFileProblem, error?: unknown) => void;

const MISSING = /ENOENT|FileNotFound|EntryNotFound|not found|no such file/i;

/** A read error that only means "the folder is not there". */
function isMissing(error: unknown): boolean {
    const e = error as { code?: unknown; message?: unknown } | undefined;
    return MISSING.test(`${String(e?.code ?? '')} ${String(e?.message ?? error)}`);
}

const hasDrive = (p: string): boolean => /^[A-Za-z]:/.test(p);
const isWindows = (): boolean => typeof process !== 'undefined' && process.platform === 'win32';

/** `file` as a slash path; a `file://` URL is decoded to its path. */
function plainPath(file: string): string {
    let f = file;
    if (/^file:\/\//i.test(f)) {
        try {
            f = decodeURIComponent(new URL(f).pathname);
        } catch {
            f = f.replace(/^file:\/\//i, '');
        }
        if (/^\/[A-Za-z]:/.test(f)) f = f.slice(1);
    }
    return f.replace(/\\/g, '/');
}

/** `file` as a clean root-relative path; undefined when empty, escaping the root, or absolute outside it. */
function relativeTracePath(file: unknown, rootPrefix: string, caseInsensitive: boolean): string | undefined {
    if (typeof file !== 'string' || !file) return undefined;
    let f = plainPath(file);
    if (f.startsWith('/') || hasDrive(f)) {
        const same = caseInsensitive ? f.toLowerCase().startsWith(rootPrefix.toLowerCase()) : f.startsWith(rootPrefix);
        if (!same) return undefined;
        f = f.slice(rootPrefix.length);
    }
    const parts: string[] = [];
    for (const part of f.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') return undefined;
        parts.push(part);
    }
    return parts.length > 0 ? parts.join('/') : undefined;
}

const stringRecord = (value: unknown): Record<string, string> | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) out[k] = typeof v === 'string' ? v : JSON.stringify(v) ?? '';
    return out;
};

interface ParsedLine { run: string; at: string; step: RunTraceStep }
interface ParsedFile { lines: ParsedLine[]; skipped: number }

/** One trace line, or undefined when it is not a valid step. */
function parseLine(text: string, rootPrefix: string, caseInsensitive: boolean): ParsedLine | undefined {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return undefined; }
    if (!raw || typeof raw !== 'object') return undefined;
    const o = raw as Record<string, unknown>;
    const path = relativeTracePath(o.file, rootPrefix, caseInsensitive);
    if (typeof o.run !== 'string' || !o.run || typeof o.at !== 'string' || !o.at || !path) return undefined;
    const args = stringRecord(o.args);
    const step: RunTraceStep = {
        path,
        ...(typeof o.fn === 'string' ? { fn: o.fn } : {}),
        ...(typeof o.line === 'number' && Number.isFinite(o.line) ? { line: o.line } : {}),
        ...(args ? { args } : {}),
        ...(typeof o.ret === 'string' ? { ret: o.ret } : {}),
    };
    return { run: o.run, at: o.at, step };
}

interface TraceFile { name: string; abs: string; size: number; mtime: number }

/** The `.jsonl` files of the trace folder, newest first (by mtime), capped; throws on a real read error. */
async function newestTraceFiles(root: CoverageRoot, base: string, report?: TraceReport): Promise<TraceFile[]> {
    let entries: Array<[string, 'file' | 'dir']>;
    try { entries = await root.fs.readDirectory(`${base}/${TRACE_DIR}`); } catch (error) {
        if (isMissing(error)) return [];
        throw error;
    }
    const names = entries.filter(([name, kind]) => kind === 'file' && name.endsWith('.jsonl')).map(([name]) => name);
    if (names.length > MAX_SCANNED_ENTRIES) report?.(TRACE_DIR, 'too-many-files');
    const found: TraceFile[] = [];
    for (const name of names.slice(0, MAX_SCANNED_ENTRIES)) {
        const abs = `${base}/${TRACE_DIR}/${name}`;
        try {
            const stat = await root.fs.stat(abs);
            found.push({ name, abs, size: stat.size, mtime: stat.mtime });
        } catch (error) {
            if (!isMissing(error)) throw error;
        }
    }
    return found.sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1)).slice(0, MAX_TRACE_FILES);
}

/** Parsed files by absolute path, valid while (size, mtime) match; holds at most the newest {@link MAX_TRACE_FILES}. */
const memo = new Map<string, { size: number; mtime: number; parsed: ParsedFile }>();

/** Forgets every memoised file (tests). */
export function clearRunTraceMemo(): void { memo.clear(); }

/** Drops the memo entries of this folder that are not in the current set, then the oldest beyond the bound. */
function pruneMemo(dirPrefix: string, current: ReadonlySet<string>): void {
    for (const key of [...memo.keys()]) if (key.startsWith(dirPrefix) && !current.has(key)) memo.delete(key);
    while (memo.size > MAX_TRACE_FILES) memo.delete(memo.keys().next().value as string);
}

/** One file parsed, or the memoised parse when its size and mtime are unchanged; undefined (reported) when it cannot be read. */
async function parsedFile(root: CoverageRoot, file: TraceFile, rootPrefix: string, caseInsensitive: boolean, report?: TraceReport): Promise<ParsedFile | undefined> {
    if (file.size > MAX_TRACE_FILE_BYTES) { report?.(file.name, 'too-large'); return undefined; }
    const hit = memo.get(file.abs);
    if (hit && hit.size === file.size && hit.mtime === file.mtime) return hit.parsed;
    let text: string;
    try { text = new TextDecoder('utf-8').decode(await root.fs.readFile(file.abs)); } catch (error) {
        report?.(file.name, 'unreadable', error);
        return undefined;
    }
    const parsed: ParsedFile = { lines: [], skipped: 0 };
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const one = parseLine(line, rootPrefix, caseInsensitive);
        if (one) parsed.lines.push(one); else parsed.skipped++;
    }
    memo.delete(file.abs);
    memo.set(file.abs, { size: file.size, mtime: file.mtime, parsed });
    return parsed;
}

interface TraceRead extends RunTraces {
    /** Trace files found (read or not). */
    files: number;
}

async function readAll(root: CoverageRoot, report?: TraceReport): Promise<TraceRead> {
    const base = slashPath(root.rootPath);
    const rootPrefix = `${base}/`;
    const caseInsensitive = isWindows() || hasDrive(base);
    const byRun = new Map<string, RunTrace>();
    let skippedLines = 0;
    let total = 0;
    const files = await newestTraceFiles(root, base, report);
    for (const file of files) {
        const parsed = await parsedFile(root, file, rootPrefix, caseInsensitive, report);
        if (!parsed) continue;
        skippedLines += parsed.skipped;
        for (const line of parsed.lines) {
            let run = byRun.get(line.run);
            if (!run) { run = { id: line.run, at: line.at, steps: [] }; byRun.set(line.run, run); }
            if (run.steps.length >= MAX_STEPS_PER_RUN || total >= MAX_TOTAL_STEPS) { skippedLines++; continue; }
            if (line.at < run.at) run.at = line.at;
            run.steps.push(line.step);
            total++;
        }
    }
    pruneMemo(`${base}/${TRACE_DIR}/`, new Set(files.map((f) => f.abs)));
    const runs = [...byRun.values()].filter((r) => r.steps.length > 0).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
    return { runs, skippedLines, files: files.length };
}

/** The recorded runs under the root: the newest {@link MAX_TRACE_FILES} files, runs oldest first. */
export async function readRunTraces(root: CoverageRoot, report?: TraceReport): Promise<RunTraces> {
    const { runs, skippedLines } = await readAll(root, report);
    return { runs, skippedLines };
}

/**
 * The `traces` row: `collected` (run count, newest run's time, dropped lines) when runs were parsed;
 * `absent` with `unparsed` when trace files exist but no run parsed; plain `absent` when there are none.
 */
export async function traceSourceState(root: CoverageRoot, report?: TraceReport): Promise<TraceSourceRow> {
    const { runs, skippedLines, files } = await readAll(root, report);
    if (runs.length > 0) {
        const latest = runs.reduce((max, r) => (r.at > max ? r.at : max), runs[0]!.at);
        return { state: 'collected', runs: runs.length, latest, ...(skippedLines > 0 ? { unparsed: skippedLines } : {}) };
    }
    if (files > 0) return { state: 'absent', unparsed: Math.max(1, skippedLines) };
    return { state: 'absent' };
}
