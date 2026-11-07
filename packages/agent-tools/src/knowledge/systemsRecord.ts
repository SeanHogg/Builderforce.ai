/**
 * knowledge/systemsRecord.ts — the systems of a reviewed root, kept with its review (PRD 41 A9).
 *
 * A review detects the root's systems ({@link detectSystems}), finds the copies among them
 * ({@link duplicateCopies}), adds what the repo graph read of each (`graphReads`), and records
 * the result in the root's manifest. A graph build ({@link readSystems}) hands it to memory,
 * which stamps `system` / `app` / `copyOf` on file nodes and reports `graph.meta.systems`.
 * Detected from the files the review SAW (its confirmed plan: ignored paths are not in it), so
 * excluding a copy from review removes it at the next review.
 */

import type { DirectorySource, GraphReadSkip, GraphSystem, PlanDetail } from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { takeGraphReads, type GraphFileReads } from './graphReads.js';
import { baseOf, byDepthThenPath, dirOf } from './systemPaths.js';
import { detectSystems, duplicateCopies, PROJECT_MANIFESTS, type DetectedSystem } from './systems.js';

/** Manifest entry holding a root's systems (one entry; its `id` is the JSON). */
export const systemsManifestKey = (rootId: string): string => `knowledge:${rootId}:systems`;
const RECORD_VERSION = 'systems/1';

/** A source that also reports the folders its walk found a `.git` in, and answers whether one folder holds a `.git` now (see `createFsDirectorySource`). */
type SystemsSource = DirectorySource & { gitRoots?(): string[]; hasGit?(folder: string): Promise<boolean> };

const within = (path: string, folder: string): boolean => folder === '' || path === folder || path.startsWith(`${folder}/`);

interface SystemReading { read: number; skipped: Map<string, number> }

/**
 * The reading of each system. Systems are detected ONCE (by the caller); here the files the graph
 * read or skipped are assigned to the deepest system containing them. A planned file the graph
 * could have read but neither read nor skipped was never listed: `planned − read − skipped`,
 * recorded as `listing-truncated` with its real count.
 */
function readsBySystem(
    systems: readonly DetectedSystem[],
    reads: GraphFileReads | undefined,
    planned: readonly string[] | undefined,
): Map<string, SystemReading> {
    const out = new Map<string, SystemReading>();
    if (!reads) return out;
    const bySpecificity = [...systems].sort((a, b) => b.path.length - a.path.length);
    const slotOf = (path: string): SystemReading | undefined => {
        const home = bySpecificity.find((s) => within(path, s.path));
        if (!home) return undefined;
        return out.get(home.path) ?? out.set(home.path, { read: 0, skipped: new Map() }).get(home.path)!;
    };
    const handled = new Set<string>();
    for (const path of reads.read) {
        handled.add(path);
        const slot = slotOf(path);
        if (slot) slot.read++;
    }
    for (const { reason, paths } of reads.skipped) {
        for (const path of paths) {
            handled.add(path);
            const slot = slotOf(path);
            if (slot) slot.skipped.set(reason, (slot.skipped.get(reason) ?? 0) + 1);
        }
    }
    for (const path of planned ?? []) {
        if (handled.has(path) || (reads.accepts && !reads.accepts(path))) continue;
        const slot = slotOf(path);
        if (slot) slot.skipped.set('listing-truncated', (slot.skipped.get('listing-truncated') ?? 0) + 1);
    }
    return out;
}

function skippedList(skipped: ReadonlyMap<string, number>): GraphReadSkip[] {
    return [...skipped].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([reason, count]) => ({ reason, count }));
}

/** The graph-ready systems: detection, copies and graph reads joined. `files` is filled by the graph build. `planned` are the review's files, to count what the graph never listed. */
export function graphSystems(
    systems: readonly DetectedSystem[],
    hashes: ReadonlyMap<string, string>,
    reads?: GraphFileReads,
    planned?: readonly string[],
): GraphSystem[] {
    const copies = new Map(duplicateCopies(systems, hashes).map((c) => [c.copy, c] as const));
    const read = readsBySystem(systems, reads, planned);
    return systems.map((s) => {
        const copy = copies.get(s.path);
        const r = read.get(s.path);
        const skipped = r ? skippedList(r.skipped) : [];
        return {
            path: s.path,
            name: s.name,
            files: 0,
            apps: s.apps.map((a) => ({ path: a.path, name: a.name })),
            ...(skipped.length > 0 ? { truncated: true } : {}),
            ...(copy ? { copyOf: copy.original, copySimilarity: copy.similarity, copyReason: copy.reason } : {}),
            ...(r ? { graphRead: { read: r.read, skipped } } : {}),
        };
    });
}

/** The files a review saw, with the hash of each where it has one. */
async function seenFiles(source: DirectorySource, plan: PlanDetail | undefined): Promise<Map<string, string>> {
    const seen = new Map<string, string>();
    if (plan) {
        for (const f of plan.files) seen.set(f.path, f.hash);
        // Manifests the plan skipped as `no-pack` (a `package.json`) still name systems; ignored files do not.
        for (const f of plan.plan.skipped) if (f.reason === 'no-pack') seen.set(f.path, '');
        return seen;
    }
    for await (const f of source.list()) seen.set(f.path, f.hash);
    return seen;
}

/**
 * The folders holding a `.git`: the ones the source's last walk saw, plus — a confirmed plan walks
 * nothing — the folders that could be systems (the root, each top-level folder, each folder with a
 * project manifest) asked of the source directly, so `hasGit` never depends on an earlier `list()`.
 */
async function gitRootsOf(source: SystemsSource, paths: readonly string[]): Promise<string[]> {
    const known = new Set(source.gitRoots?.() ?? []);
    if (source.hasGit) {
        const candidates = new Set<string>(['']);
        for (const p of paths) {
            const slashAt = p.indexOf('/');
            if (slashAt > 0) candidates.add(p.slice(0, slashAt));
            if (PROJECT_MANIFESTS.includes(baseOf(p))) candidates.add(dirOf(p));
        }
        for (const folder of [...candidates].sort(byDepthThenPath)) {
            if (known.has(folder) || [...known].some((g) => within(folder, g))) continue;
            if (await source.hasGit(folder)) known.add(folder);
        }
    }
    return [...known].sort();
}

/** Detects, records and returns a root's systems after its review. A failure here is the caller's to report, never a failed review. */
export async function recordSystems(args: {
    rootId: string;
    /** The reviewed folder's name: what a one-system root is called. */
    rootName: string;
    source: SystemsSource;
    manifest: IngestManifest;
    plan?: PlanDetail;
}): Promise<GraphSystem[]> {
    const { rootId, source } = args;
    const seen = await seenFiles(source, args.plan);
    const paths = [...seen.keys()];
    const hashes = new Map([...seen].filter(([, hash]) => hash !== ''));
    // The ONE detection of systems: the graph reads below are assigned to what it finds.
    const detected = await detectSystems(
        { rootName: args.rootName, paths, hashes, gitRoots: await gitRootsOf(source, paths) },
        async (path) => {
            const doc = await source.read(path);
            return doc.content.kind === 'text' ? doc.content.text : undefined;
        },
    );
    // Only a plan says which files the review meant to cover, so only with one can unlisted files be counted.
    const planned = args.plan?.files.map((f) => f.path);
    const systems = graphSystems(detected.systems, hashes, takeGraphReads(rootId), planned);
    await args.manifest.set(systemsManifestKey(rootId), [{ id: JSON.stringify(systems), hash: RECORD_VERSION }]);
    return systems;
}

/** The systems a review recorded for a root; empty when it recorded none (or an older shape). */
export async function readSystems(manifest: IngestManifest, rootId: string): Promise<GraphSystem[]> {
    const entry = (await manifest.get(systemsManifestKey(rootId)))?.find((e) => e.hash === RECORD_VERSION);
    if (!entry) return [];
    try {
        const parsed: unknown = JSON.parse(entry.id);
        return Array.isArray(parsed) ? (parsed as GraphSystem[]) : [];
    } catch {
        return [];
    }
}
