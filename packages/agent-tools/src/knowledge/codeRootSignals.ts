/**
 * knowledge/codeRootSignals.ts — the code pack's ROOT-level signals, read once per review
 * (PRD 38, Option B+ Contract 1): coverage (`coverage`), version history (`churn`),
 * CODEOWNERS (`owner`) and the package entry points a manifest names (`entry`). They are
 * not a property of one file's text, so the per-file parser cannot see them. This reads each
 * source once and emits ONE root-level `Extracted` holding every signal node, which memory
 * merges onto the parser's file nodes.
 *
 * Every source is optional and a failure of one is the absence of its badge, never a
 * failed review: no coverage files ⇒ no `coverage`, no history port ⇒ no `churn`, no
 * CODEOWNERS ⇒ no `owner`. Signals are read only for the files the review extracted
 * (the caller's `knownPaths`); `buildCodeGraph` drops any that still have no parser node.
 */

import {
    canonicalJson, coChangePartners, compareStr, decodeCoChange, encodeCoChange, srcRef,
    type AnalyzerPort, type Extracted, type KNode, type NodeRef,
} from '@seanhogg/builderforce-memory/knowledge';
import { hashText } from '@seanhogg/builderforce-memory/ingest';
import { readCoverage, type CoverageRoot, type CoverageSkip } from './codeCoverage.js';
import { codeFileNode, CODE_BADGES, ROOT_OUTPUT_HASH_PREFIX, ROOT_SIGNALS_REF } from './codeNodes.js';
import { CODEOWNERS_LOCATIONS, ownersFor, parseCodeOwners } from './codeOwners.js';
import { isCodePath } from './codePack.js';
import type { KnowledgeFs } from './fsDirectorySource.js';
import { CHURN_DAYS, churnOf, HISTORY_DAYS, HISTORY_MAX_COMMITS, type HistoryCommit, type HistoryPort } from './historyPort.js';
import { slashPath } from './rootRelative.js';

export interface RootSignalsDeps {
    /** The reviewed folder on disk: coverage files and CODEOWNERS are read from it. Absent ⇒ neither. */
    files?: CoverageRoot;
    /** Version history. Absent ⇒ no churn. */
    history?: HistoryPort;
    /** The entry points the package manifests among `candidates` name (see `readEntryPaths`). Absent ⇒ no `entry` badges. */
    entryPaths?(candidates: readonly string[]): Promise<ReadonlySet<string>>;
    /** Told what was left out of the signals and why (stale or oversize coverage). */
    onSkipped?(skipped: readonly CoverageSkip[]): void;
}

export interface RootSignals {
    coverage: ReadonlyMap<string, number>;
    churn: ReadonlyMap<string, number>;
    owners: ReadonlyMap<string, string>;
    entries: ReadonlySet<string>;
    skipped: readonly CoverageSkip[];
    /** The root's commits (newest first), paths cut to the review's code files: the `coChange` input. Absent ⇒ no co-change. */
    history?: readonly HistoryCommit[];
}

const settled = async <T>(job: () => Promise<T>, empty: T): Promise<T> => {
    try { return await job(); } catch { return empty; }
};

async function readOwners(fs: KnowledgeFs, rootPath: string, paths: readonly string[]): Promise<Map<string, string>> {
    const base = slashPath(rootPath);
    for (const location of CODEOWNERS_LOCATIONS) {
        try {
            const text = new TextDecoder('utf-8').decode(await fs.readFile(`${base}/${location}`));
            return ownersFor(paths, parseCodeOwners(text));
        } catch { /* Not at this location. */ }
    }
    return new Map();
}

/** Reads the signals for `candidates` (root-relative paths the review saw); results for files outside its code files are dropped. */
export async function readRootSignals(deps: RootSignalsDeps, candidates: readonly string[]): Promise<RootSignals> {
    const paths = candidates.filter(isCodePath);
    const [coverage, commits, owners, entries] = await Promise.all([
        deps.files ? settled(() => readCoverage(deps.files!), { values: new Map<string, number>(), skipped: [] as CoverageSkip[] }) : { values: new Map<string, number>(), skipped: [] as CoverageSkip[] },
        // ONE history read serves churn (its last CHURN_DAYS) and co-change (all of it).
        deps.history ? settled(() => deps.history!.commits(HISTORY_DAYS, HISTORY_MAX_COMMITS), [] as HistoryCommit[]) : [] as HistoryCommit[],
        deps.files ? settled(() => readOwners(deps.files!.fs, deps.files!.rootPath, paths), new Map<string, string>()) : new Map<string, string>(),
        deps.entryPaths ? settled(() => deps.entryPaths!(candidates), new Set<string>() as ReadonlySet<string>) : new Set<string>() as ReadonlySet<string>,
    ]);
    const known = new Set(paths);
    const only = <V>(m: ReadonlyMap<string, V>): Map<string, V> => new Map([...m].filter(([path]) => known.has(path)));
    return {
        coverage: only(coverage.values), churn: churnOf(commits, paths, CHURN_DAYS), owners: only(owners),
        entries: new Set([...entries].filter((p) => known.has(p))), skipped: coverage.skipped,
        // Each commit keeps only the review's code files; `fileCount` stays the whole commit's for the bulk cut.
        history: commits.map((c) => ({ ...c, paths: c.paths.filter((p) => known.has(p)) })),
    };
}

/**
 * The `coChange` badge value per path (PRD 38 P4): memory's partners over the history, refs in the file-node form churn's
 * nodes use. A file with no partner — or whose partners all fail to encode — gets no entry: never an empty badge.
 */
function coChangeOf(history: readonly HistoryCommit[], rootId: string): Map<string, string> {
    const out = new Map<string, string>();
    if (history.length === 0) return out;
    const pathOf = new Map<NodeRef, string>();
    const commits = history.map((c) => ({
        at: c.at, fileCount: c.fileCount,
        refs: c.paths.map((path) => { const ref = srcRef(rootId, path); pathOf.set(ref, path); return ref; }),
    }));
    for (const [ref, partners] of coChangePartners(commits)) {
        const path = pathOf.get(ref);
        if (path === undefined || partners.length === 0) continue;
        const value = encodeCoChange(partners);
        if (decodeCoChange(value).length > 0) out.set(path, value);
    }
    return out;
}

/** The ONE root-level `Extracted` of all signal nodes (none when no file has a signal). */
export function rootSignalsToExtracted(signals: RootSignals, rootId: string): Extracted[] {
    const badges = new Map<string, Record<string, number | string>>();
    const put = (path: string, badge: string, value: number | string): void => {
        badges.set(path, { ...badges.get(path), [badge]: value });
    };
    for (const [path, value] of signals.coverage) put(path, CODE_BADGES.coverage, value);
    for (const [path, value] of signals.churn) if (value > 0) put(path, CODE_BADGES.churn, value);
    for (const [path, value] of signals.owners) put(path, CODE_BADGES.owner, value);
    for (const path of signals.entries) put(path, CODE_BADGES.entry, 1);
    for (const [path, value] of coChangeOf(signals.history ?? [], rootId)) put(path, CODE_BADGES.coChange, value);
    if (badges.size === 0) return [];
    const nodes: KNode[] = [...badges].sort((a, b) => compareStr(a[0], b[0])).map(([path, b]) => codeFileNode(rootId, path, { badges: b }));
    const body = { nodes, edges: [], keys: [] as Extracted['keys'] };
    return [{ sourceRef: ROOT_SIGNALS_REF, sourceHash: `${ROOT_OUTPUT_HASH_PREFIX}code-signals:${hashText(canonicalJson(body))}`, ...body }];
}

/** Root-relative code paths named by the `src:` refs of root-level output. */
function pathsOfExtracted(extracted: readonly Extracted[], rootId: string): string[] {
    const prefix = `src:${rootId}::`;
    return extracted.flatMap((e) => e.nodes.map((n) => n.ref).filter((r) => r.startsWith(prefix)).map((r) => r.slice(prefix.length)));
}

/**
 * The analyzers plus the root signals. `candidates` names the files the review saw (its
 * plan's files, so no second walk); the analyzers' own files stand in when it is empty. Output order: the
 * inner analyzers', then the one signals `Extracted`.
 */
export function withRootSignals(
    inner: AnalyzerPort | undefined,
    deps: RootSignalsDeps,
    candidates: () => Promise<Iterable<string>>,
): AnalyzerPort | undefined {
    if (!deps.files && !deps.history && !deps.entryPaths) return inner;
    return {
        async analyse(rootId, signal) {
            const out = inner ? await inner.analyse(rootId, signal) : [];
            if (signal?.aborted) return out;
            const seen = await settled(async () => [...await candidates()], [] as string[]);
            // The review's own file list decides; the analyzers' files (which can include ignored ones) only stand in when there is none.
            const all = [...new Set(seen.length > 0 ? seen : pathsOfExtracted(out, rootId))].sort(compareStr);
            const signals = await readRootSignals(deps, all);
            if (signals.skipped.length > 0) deps.onSkipped?.(signals.skipped);
            return [...out, ...rootSignalsToExtracted(signals, rootId)];
        },
    };
}
