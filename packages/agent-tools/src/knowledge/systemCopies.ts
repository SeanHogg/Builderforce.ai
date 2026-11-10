/**
 * knowledge/systemCopies.ts — which systems of a review root copy another (PRD 41 A9 rule 2).
 *
 * Two kinds of copy, both decided from content hashes at the SAME relative paths:
 *   • a loose top-level folder with no `.git` that matches a git system ({@link strayFolders}).
 *     It is found BEFORE manifests choose systems, so a copy of a repository whose root holds no
 *     manifest is one system (a copy), never split into the manifests inside it;
 *   • two systems that name the same project ({@link duplicateCopies}).
 * Pure and deterministic.
 */

import type { DetectedSystem } from './systems.js';
import { baseOf, joinPath, rel, within } from './systemPaths.js';
import { strideSample } from '../sampling.js';

/** Files compared per pair of systems: a stride across the whole sorted path list. */
export const COPY_SAMPLE = 200;
/** Share of the sample that must hash the same for one system to be a copy of the other. */
export const COPY_SIMILARITY = 0.9;
/** A sample smaller than this proves nothing. */
const MIN_COPY_SAMPLE = 3;

export type CopyReason = 'no-git' | 'name-mismatch' | 'later-name';

export interface DuplicateCopy { copy: string; original: string; similarity: number; reason: CopyReason }

/** `n` items spread evenly across the whole list, so a long tree is judged by all of it, not its first folder (THE sampler, `sampling.ts`). */
export { strideSample };

/** The share of a sample of the smaller side (sorted relative paths) whose hash is the same on the other side; undefined when the sample is too small to prove anything. */
function sampleSimilarity(
    a: { root: string; files: readonly string[] },
    b: { root: string; files: readonly string[] },
    hashes: ReadonlyMap<string, string>,
): number | undefined {
    const [small, other] = a.files.length <= b.files.length ? [a, b] : [b, a];
    const sample = strideSample(small.files, COPY_SAMPLE);
    if (sample.length < MIN_COPY_SAMPLE) return undefined;
    const same = sample.filter((f) => {
        const h = hashes.get(joinPath(small.root, f));
        return h !== undefined && h === hashes.get(joinPath(other.root, f));
    }).length;
    return Math.round((same / sample.length) * 1e4) / 1e4;
}

/**
 * Top-level folders that hold no `.git` (and no repository) yet whose files hash like a git
 * system's at the same relative paths: stray copies of a repository, each with the git system it
 * copies (the best match). `gitRoots` are root-relative folders that hold a `.git`.
 */
export function strayFolders(
    paths: readonly string[],
    gitRoots: readonly string[],
    hashes: ReadonlyMap<string, string>,
): Array<{ path: string; original: string; similarity: number }> {
    const gits = gitRoots.filter((g) => g !== '').sort((a, b) => b.length - a.length);
    if (gits.length === 0) return [];
    const gitFiles = new Map<string, string[]>();
    const folderFiles = new Map<string, string[]>();
    for (const p of paths) {
        if (!hashes.has(p)) continue;
        const git = gits.find((g) => within(p, g));
        if (git) { (gitFiles.get(git) ?? gitFiles.set(git, []).get(git)!).push(rel(p, git)); continue; }
        const slashAt = p.indexOf('/');
        if (slashAt < 0) continue;
        const top = p.slice(0, slashAt);
        if (gits.some((g) => within(g, top))) continue; // a folder holding a repository is not a stray copy
        (folderFiles.get(top) ?? folderFiles.set(top, []).get(top)!).push(rel(p, top));
    }
    const out: Array<{ path: string; original: string; similarity: number }> = [];
    for (const top of [...folderFiles.keys()].sort()) {
        let best: { original: string; similarity: number } | undefined;
        for (const g of [...gitFiles.keys()].sort()) {
            const similarity = sampleSimilarity(
                { root: top, files: folderFiles.get(top)!.sort() },
                { root: g, files: gitFiles.get(g)!.sort() },
                hashes,
            );
            if (similarity !== undefined && similarity >= COPY_SIMILARITY && (!best || similarity > best.similarity)) best = { original: g, similarity };
        }
        if (best) out.push({ path: top, ...best });
    }
    return out;
}

/** Which of two matching systems is the copy, and why. */
function chooseCopy(a: DetectedSystem, b: DetectedSystem): { copy: DetectedSystem; original: DetectedSystem; reason: CopyReason } {
    if (a.hasGit !== b.hasGit) return a.hasGit ? { copy: b, original: a, reason: 'no-git' } : { copy: a, original: b, reason: 'no-git' };
    const aOff = a.manifestName !== undefined && a.name !== a.manifestName && !a.manifestName.endsWith(`/${a.name}`);
    const bOff = b.manifestName !== undefined && b.name !== b.manifestName && !b.manifestName.endsWith(`/${b.name}`);
    if (aOff !== bOff) return aOff ? { copy: a, original: b, reason: 'name-mismatch' } : { copy: b, original: a, reason: 'name-mismatch' };
    return a.name > b.name || (a.name === b.name && a.path > b.path)
        ? { copy: a, original: b, reason: 'later-name' }
        : { copy: b, original: a, reason: 'later-name' };
}

/** The names a system answers to: its manifest's project name (and the part after a scope), and its folder's name. */
const namesOf = (s: DetectedSystem): string[] => [
    ...(s.manifestName ? [s.manifestName, baseOf(s.manifestName)] : []),
    s.name,
];

/**
 * Whether two systems are the same project: their manifests name the same project, or — when one
 * has no manifest name (a repository whose root holds no manifest) — a name of the other (its
 * manifest's project, or its folder) is the one's folder name.
 */
function sameProject(a: DetectedSystem, b: DetectedSystem): boolean {
    if (a.manifestName !== undefined && b.manifestName !== undefined) return a.manifestName === b.manifestName;
    const [bare, other] = a.manifestName === undefined ? [a, b] : [b, a];
    return namesOf(other).includes(bare.name);
}

/**
 * Systems that copy another: those found as stray folders (marked `copy` by detection), and two
 * whose names say the same project and whose files, at the same relative paths, hash alike for at
 * least 90% of a sample of 200 (a stride across the sorted paths of the smaller system). `hashes`
 * is every file's content hash by root-relative path.
 */
export function duplicateCopies(systems: readonly DetectedSystem[], hashes: ReadonlyMap<string, string>): DuplicateCopy[] {
    const filesOf = new Map<string, string[]>();
    for (const s of systems) {
        const others = systems.filter((o) => o !== s && o.path.length > s.path.length && within(o.path, s.path));
        const own = [...hashes.keys()].filter((p) => s.path !== '' && within(p, s.path) && !others.some((o) => within(p, o.path)));
        filesOf.set(s.path, own.map((p) => rel(p, s.path)).sort());
    }
    const found = new Map<string, DuplicateCopy>();
    for (const s of systems) {
        if (s.copy) found.set(s.path, { copy: s.path, original: s.copy.original, similarity: s.copy.similarity, reason: 'no-git' });
    }
    const sorted = [...systems].filter((s) => s.path !== '').sort((a, b) => (a.path < b.path ? -1 : 1));
    for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
            const a = sorted[i]!, b = sorted[j]!;
            if (!sameProject(a, b) || within(a.path, b.path) || within(b.path, a.path)) continue;
            const similarity = sampleSimilarity({ root: a.path, files: filesOf.get(a.path)! }, { root: b.path, files: filesOf.get(b.path)! }, hashes);
            if (similarity === undefined || similarity < COPY_SIMILARITY) continue;
            const { copy, original, reason } = chooseCopy(a, b);
            if (!found.has(copy.path)) found.set(copy.path, { copy: copy.path, original: original.path, similarity, reason });
        }
    }
    // A copy of a copy points at the system the chain starts from.
    const out = [...found.values()].sort((x, y) => (x.copy < y.copy ? -1 : 1));
    return out.map((c) => {
        let original = c.original;
        for (let hop = 0; hop < out.length && found.has(original) && original !== c.copy; hop++) original = found.get(original)!.original;
        return { ...c, original };
    });
}
