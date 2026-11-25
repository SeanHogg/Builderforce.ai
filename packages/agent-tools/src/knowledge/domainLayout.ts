/**
 * knowledge/domainLayout.ts — "organize by domain": proposes a folder layout for the loose code files of
 * one folder, from what the code pack's graph already holds (the file paths and the import edges).
 *
 * A file joins a domain by, in order of strength:
 *   1. its first name token naming a folder that is already there (`existing-folder`);
 *   2. its first name token shared by {@link MIN_DOMAIN_SIZE} or more modules (`name`) — a new folder;
 *   3. being the test of a module that has a domain (`test-subject`);
 *   4. most of its import weight going to files that have one (`imports`), repeated until it settles.
 * What none of these places stays where it is (`unassigned`).
 *
 * Pure and deterministic (ties break alphabetically): no I/O, Worker-safe. The host applies a proposal
 * (moves with git, imports rewritten by `importRewrite.ts`); this only decides.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { CODE_PACK_ID } from './codeNodes.js';
import { sourcePathOf } from './rootId.js';

/** Modules (tests excluded) sharing a first name token before it becomes a new folder. */
export const MIN_DOMAIN_SIZE = 3;
/** The share of a file's weight to assigned neighbours the winning domain needs for an import vote. */
export const AFFINITY_MIN = 0.5;
export const MAX_VOTE_PASSES = 10;
/** Entry files that stay where they are, by base name. */
export const KEEP_AT_ROOT: readonly string[] = ['extension.ts', 'index.ts', 'main.ts', 'main.tsx'];
/** A domain id is a folder name the host will create: letters and digits, no separator. */
export const DOMAIN_ID = /^[A-Za-z][A-Za-z0-9-]*$/;

const MIN_STEM_LENGTH = 3;
const CODE_FILE = /\.(ts|tsx|mts|js|mjs)$/;
const DECLARATION_FILE = /\.d\.ts$/;
const TEST_FILE = /\.(test|spec)\.[^./]+$/;
const FILE_EDGE_KIND = 'references';

export type DomainReason = 'existing-folder' | 'name' | 'test-subject' | 'imports';

export interface DomainFileEdge { from: string; to: string; weight?: number }

export interface DomainLayoutInput {
    /** Root-relative folder whose loose files are organized ('' = the root). */
    folder: string;
    /** Every code file of the root, root-relative. */
    files: readonly string[];
    edges: readonly DomainFileEdge[];
    /** Base names that stay put (defaults to {@link KEEP_AT_ROOT}). */
    keepAtRoot?: readonly string[];
}

export interface DomainMove { from: string; to: string; domain: string; reason: DomainReason }
/** `files` are the paths after the move. */
export interface DomainGroup { id: string; isNew: boolean; files: string[] }

export interface DomainLayout {
    folder: string;
    domains: DomainGroup[];
    moves: DomainMove[];
    unassigned: string[];
    conflicts: { from: string; to: string }[];
    /** Cohesion: file edges crossing domains inside the folder, as it is and as it would be. */
    crossEdges: { before: number; after: number };
}

const normalized = (p: string): string => p.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
const dirOf = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')));
const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
const join = (folder: string, name: string): string => (folder ? `${folder}/${name}` : name);
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isModule = (p: string): boolean => CODE_FILE.test(p) && !DECLARATION_FILE.test(p);
const isTest = (base: string): boolean => TEST_FILE.test(base);
const sameDomainName = (a: string, b: string): boolean => a === b || `${a}s` === b || a === `${b}s`;

/** The first name token of a file: `attachmentDownload.test.ts` → `attachment`. */
export function stemOf(basename: string): string {
    const name = basename.replace(TEST_FILE, '').replace(/\.[^./]+$/, '');
    const token = name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[\s\-_.]+/)
        .find((t) => t !== '');
    return (token ?? '').toLowerCase();
}

/** The layout input of one root's graph: its code files and the import edges between them. */
export function domainInputOf(graph: KnowledgeGraph, rootId: string, folder: string): DomainLayoutInput {
    const files = new Map<string, string>();
    for (const node of graph.nodes) {
        if (node.pack !== CODE_PACK_ID || node.kind !== 'file') continue;
        const path = sourcePathOf(node.ref, rootId);
        if (path) files.set(node.ref, path);
    }
    const edges: DomainFileEdge[] = [];
    for (const edge of graph.edges) {
        if (edge.kind !== FILE_EDGE_KIND) continue;
        const from = files.get(edge.from);
        const to = files.get(edge.to);
        if (from && to && from !== to) edges.push({ from, to, weight: edge.weight });
    }
    return { folder: normalized(folder), files: [...files.values()].sort(byText), edges };
}

/** The domain a path sits in under `folder` (its first sub-folder), or the path itself when it is loose. */
function domainBefore(path: string, prefix: string): string {
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    return slash > 0 ? rest.slice(0, slash) : path;
}

export function proposeDomainLayout(input: DomainLayoutInput): DomainLayout {
    const folder = normalized(input.folder);
    const prefix = folder ? `${folder}/` : '';
    const keep = new Set(input.keepAtRoot ?? KEEP_AT_ROOT);
    const inFolder = input.files.filter((f) => f.startsWith(prefix));

    const candidates = inFolder
        .filter((f) => dirOf(f) === folder && isModule(f) && !keep.has(baseOf(f)))
        .sort(byText);
    const existing = new Set<string>(); // the folder's sub-folders
    for (const f of inFolder) {
        const rest = f.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash > 0) existing.add(rest.slice(0, slash));
    }
    const existingNames = [...existing].sort(byText);

    const domainOfPath = new Map<string, { domain: string; reason: DomainReason }>();
    const assign = (path: string, domain: string, reason: DomainReason): void => { domainOfPath.set(path, { domain, reason }); };
    const existingMatch = (stem: string): string | undefined => existingNames.find((n) => sameDomainName(n.toLowerCase(), stem));

    // 1–2: by name. Only modules count towards a new folder, never their tests.
    const stemCounts = new Map<string, number>();
    for (const f of candidates) {
        if (isTest(baseOf(f))) continue;
        const stem = stemOf(baseOf(f));
        stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
    }
    const newDomains = new Set<string>();
    for (const [stem, count] of stemCounts) {
        if (count >= MIN_DOMAIN_SIZE && stem.length >= MIN_STEM_LENGTH && DOMAIN_ID.test(stem) && !existingMatch(stem)) newDomains.add(stem);
    }
    const byName = (path: string): void => {
        const stem = stemOf(baseOf(path));
        const known = existingMatch(stem);
        if (known) assign(path, known, 'existing-folder');
        else if (newDomains.has(stem)) assign(path, stem, 'name');
    };
    for (const f of candidates) if (!isTest(baseOf(f))) byName(f);

    // 3: a test follows its subject; with no placed subject it still follows its name.
    const subjects = new Map<string, string>(); // `dir/name` without extension → module path
    for (const f of candidates) if (!isTest(baseOf(f))) subjects.set(f.replace(/\.[^./]+$/, ''), f);
    const placeTests = (): void => {
        for (const f of candidates) {
            if (!isTest(baseOf(f)) || domainOfPath.has(f)) continue;
            const subject = subjects.get(f.replace(TEST_FILE, ''));
            const placed = subject ? domainOfPath.get(subject) : undefined;
            if (placed) assign(f, placed.domain, 'test-subject');
            else byName(f);
        }
    };
    placeTests();

    // 4: the import vote, over the files that already have a domain (loose ones assigned so far and the existing sub-folders').
    const neighbours = new Map<string, { other: string; weight: number }[]>();
    const link = (a: string, b: string, weight: number): void => {
        const list = neighbours.get(a);
        if (list) list.push({ other: b, weight }); else neighbours.set(a, [{ other: b, weight }]);
    };
    for (const e of input.edges) {
        const weight = e.weight ?? 1;
        link(e.from, e.to, weight);
        link(e.to, e.from, weight);
    }
    const domainNow = (path: string): string | undefined => {
        const assigned = domainOfPath.get(path);
        if (assigned) return assigned.domain;
        return path.startsWith(prefix) && dirOf(path) !== folder ? domainBefore(path, prefix) : undefined;
    };
    for (let pass = 0; pass < MAX_VOTE_PASSES; pass++) {
        const decided: { path: string; domain: string }[] = [];
        for (const f of candidates) {
            if (domainOfPath.has(f)) continue;
            const votes = new Map<string, number>();
            let total = 0;
            for (const { other, weight } of neighbours.get(f) ?? []) {
                const domain = domainNow(other);
                // A sub-folder that is no valid domain id (`__mocks__`, `@types`) is never a target: the host would refuse it.
                if (!domain || !DOMAIN_ID.test(domain)) continue;
                votes.set(domain, (votes.get(domain) ?? 0) + weight);
                total += weight;
            }
            const [winner] = [...votes].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]));
            if (winner && total > 0 && winner[1] / total >= AFFINITY_MIN) decided.push({ path: f, domain: winner[0] });
        }
        if (decided.length === 0) break;
        for (const d of decided) assign(d.path, d.domain, 'imports');
        placeTests();
    }

    // Moves, with a target that already exists (compared case-insensitively: the user is on Windows) a conflict instead.
    const taken = new Set(input.files.map((f) => f.toLowerCase()));
    const moves: DomainMove[] = [];
    const conflicts: { from: string; to: string }[] = [];
    const unassigned: string[] = [];
    for (const f of candidates) {
        const placed = domainOfPath.get(f);
        if (!placed) { unassigned.push(f); continue; }
        const to = join(join(folder, placed.domain), baseOf(f));
        if (taken.has(to.toLowerCase())) conflicts.push({ from: f, to });
        else moves.push({ from: f, to, domain: placed.domain, reason: placed.reason });
    }

    const groups = new Map<string, DomainGroup>();
    for (const m of moves) {
        const group = groups.get(m.domain) ?? { id: m.domain, isNew: !existing.has(m.domain), files: [] as string[] };
        group.files.push(m.to);
        groups.set(m.domain, group);
    }
    for (const group of groups.values()) {
        if (!group.isNew) group.files.push(...inFolder.filter((f) => f.startsWith(join(folder, group.id) + '/')));
        group.files.sort(byText);
    }

    const movedTo = new Map(moves.map((m) => [m.from, m.to]));
    const crossing = (domainOf: (path: string) => string): number =>
        input.edges.filter((e) => e.from.startsWith(prefix) && e.to.startsWith(prefix) && domainOf(e.from) !== domainOf(e.to)).length;
    const before = crossing((p) => domainBefore(p, prefix));
    const after = crossing((p) => domainBefore(movedTo.get(p) ?? p, prefix));

    return {
        folder,
        domains: [...groups.values()].sort((a, b) => byText(a.id, b.id)),
        moves,
        unassigned,
        conflicts,
        crossEdges: { before, after },
    };
}
