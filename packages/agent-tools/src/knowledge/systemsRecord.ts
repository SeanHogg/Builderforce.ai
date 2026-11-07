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
import { takeGraphReads, type SystemGraphRead } from './graphReads.js';
import { detectSystems, duplicateCopies, type DetectedSystem } from './systems.js';

/** Manifest entry holding a root's systems (one entry; its `id` is the JSON). */
export const systemsManifestKey = (rootId: string): string => `knowledge:${rootId}:systems`;
const RECORD_VERSION = 'systems/1';

/** A source that also reports the folders its walk found a `.git` in (see `createFsDirectorySource`). */
type SystemsSource = DirectorySource & { gitRoots?(): string[] };

const within = (path: string, folder: string): boolean => folder === '' || path === folder || path.startsWith(`${folder}/`);

/** The reading of each system, matched to the systems recorded: a path no system has goes to the deepest one containing it. */
function readsBySystem(systems: readonly DetectedSystem[], reads: readonly SystemGraphRead[] | undefined): Map<string, { read: number; skipped: Map<string, number> }> {
    const out = new Map<string, { read: number; skipped: Map<string, number> }>();
    for (const r of reads ?? []) {
        const home = systems.filter((s) => within(r.path, s.path)).sort((a, b) => b.path.length - a.path.length)[0];
        if (!home) continue;
        const slot = out.get(home.path) ?? { read: 0, skipped: new Map() };
        slot.read += r.read;
        for (const s of r.skipped) slot.skipped.set(s.reason, (slot.skipped.get(s.reason) ?? 0) + s.count);
        out.set(home.path, slot);
    }
    return out;
}

function skippedList(skipped: ReadonlyMap<string, number>): GraphReadSkip[] {
    return [...skipped].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([reason, count]) => ({ reason, count }));
}

/** The graph-ready systems: detection, copies and graph reads joined. `files` is filled by the graph build. */
export function graphSystems(
    systems: readonly DetectedSystem[],
    hashes: ReadonlyMap<string, string>,
    reads?: readonly SystemGraphRead[],
): GraphSystem[] {
    const copies = new Map(duplicateCopies(systems, hashes).map((c) => [c.copy, c] as const));
    const read = readsBySystem(systems, reads);
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
    const detected = await detectSystems(
        { rootName: args.rootName, paths: [...seen.keys()], ...(source.gitRoots ? { gitRoots: source.gitRoots() } : {}) },
        async (path) => {
            const doc = await source.read(path);
            return doc.content.kind === 'text' ? doc.content.text : undefined;
        },
    );
    const hashes = new Map([...seen].filter(([, hash]) => hash !== ''));
    const systems = graphSystems(detected.systems, hashes, takeGraphReads(rootId));
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
