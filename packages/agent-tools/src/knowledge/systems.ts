/**
 * knowledge/systems.ts — a review root divided into SYSTEMS and APPS (PRD 41 A9 rule 1).
 *
 * A folder holding five repositories and two loose copies is not one project. A system is:
 *   • a folder with its own `.git` (directory or file); else
 *   • the topmost folder whose manifest names a project (`package.json` with a `name`,
 *     `Cargo.toml`, `pyproject.toml`, `go.mod`) that is not inside another system;
 *   • a root that is itself a repository is ONE system, named after its folder.
 * Inside a system, its workspace packages (`package.json` `workspaces`, `pnpm-workspace.yaml`)
 * are its apps.
 *
 * A top-level folder with no `.git` whose files hash like a git system's ({@link strayFolders}) is
 * ONE system, marked a copy: its manifests are never split into systems of their own.
 *
 * Pure and deterministic: from the file listing plus small manifest reads through a port. No I/O.
 */

import { strayFolders } from './systemCopies.js';
import { baseOf, byDepthThenPath, dirOf, joinPath, rel, slash, within } from './systemPaths.js';

export { COPY_SAMPLE, COPY_SIMILARITY, duplicateCopies, type CopyReason, type DuplicateCopy } from './systemCopies.js';

/** The files a root holds (root-relative, `/`-separated) and, optionally, folders a walk saw hold a `.git` ('' = the root). */
export interface SystemsListing {
    /** The reviewed folder's own name: what a one-system root is called. */
    rootName: string;
    paths: readonly string[];
    /** Folders with a `.git` entry the walk saw. A `.git/` segment in `paths` says the same. */
    gitRoots?: readonly string[];
}

/** Reads a manifest by root-relative path; undefined when it cannot be read. */
export type ReadManifest = (path: string) => Promise<string | undefined>;

export interface DetectedApp { path: string; name: string }

export interface DetectedSystem {
    /** Root-relative folder; '' when the root itself is the system. */
    path: string;
    /** The folder's name (the root's name for ''). */
    name: string;
    hasGit: boolean;
    /** The project name its manifest declares, when it has one. */
    manifestName?: string;
    apps: DetectedApp[];
}

export interface DetectedSystems {
    systems: DetectedSystem[];
    /** The system path a root-relative path is in (the deepest), or undefined when it is in none. */
    systemOf(path: string): string | undefined;
    /** The app path a root-relative path is in (the deepest), or undefined. */
    appOf(path: string): string | undefined;
}

/** Manifests that name a project, by file name. */
const PROJECT_MANIFESTS: readonly string[] = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod'];
const MAX_APPS_PER_SYSTEM = 500;


/** The project name a manifest declares; undefined when it names no project. */
export function manifestProjectName(file: string, text: string): string | undefined {
    const name = baseOf(file);
    if (name === 'package.json') {
        try {
            const n = (JSON.parse(text) as { name?: unknown }).name;
            return typeof n === 'string' && n.trim() ? n.trim() : undefined;
        } catch { return undefined; }
    }
    if (name === 'go.mod') return /^\s*module\s+(\S+)/m.exec(text)?.[1];
    if (name === 'Cargo.toml' || name === 'pyproject.toml') {
        const tables = name === 'Cargo.toml' ? ['package'] : ['project', 'tool.poetry'];
        let table = '';
        for (const line of text.split(/\r?\n/)) {
            const head = /^\s*\[([^\]]+)\]\s*$/.exec(line);
            if (head) { table = head[1]!.trim(); continue; }
            const m = tables.includes(table) ? /^\s*name\s*=\s*["']([^"']+)["']/.exec(line) : null;
            if (m) return m[1];
        }
        // A Cargo workspace root is a project of its own (no [package]).
        if (name === 'Cargo.toml' && /^\s*\[workspace\]/m.test(text)) return baseOf(dirOf(file)) || 'workspace';
    }
    return undefined;
}

/** `packages/*`, `apps/**`, `tools/cli` as a test over a system-relative folder. */
function globTest(pattern: string): (folder: string) => boolean {
    const src = slash(pattern).split('/').map((seg) => (seg === '**' ? '.*' : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))).join('/');
    const re = new RegExp(`^${src}$`);
    return (folder) => re.test(folder);
}

/** The workspace globs a system's `package.json` / `pnpm-workspace.yaml` declare. */
function workspaceGlobs(pkg: string | undefined, pnpm: string | undefined): string[] {
    const out: string[] = [];
    if (pkg) {
        try {
            const w = (JSON.parse(pkg) as { workspaces?: unknown }).workspaces;
            const list = Array.isArray(w) ? w : Array.isArray((w as { packages?: unknown } | undefined)?.packages) ? (w as { packages: unknown[] }).packages : [];
            for (const g of list) if (typeof g === 'string') out.push(g);
        } catch { /* not JSON: no workspaces */ }
    }
    if (pnpm) {
        let inPackages = false;
        for (const line of pnpm.split(/\r?\n/)) {
            if (/^\S/.test(line)) { inPackages = /^packages\s*:/.test(line); continue; }
            const m = inPackages ? /^\s*-\s*["']?([^"'#\s]+)["']?/.exec(line) : null;
            if (m) out.push(m[1]!);
        }
    }
    return out;
}

async function appsOf(system: string, paths: readonly string[], has: ReadonlySet<string>, read: ReadManifest): Promise<DetectedApp[]> {
    const only = (file: string): Promise<string | undefined> => (has.has(joinPath(system, file)) ? read(joinPath(system, file)) : Promise.resolve(undefined));
    const [pkg, pnpm] = await Promise.all([only("package.json"), only("pnpm-workspace.yaml")]);
    const globs = workspaceGlobs(pkg, pnpm);
    if (globs.length === 0) return [];
    const include = globs.filter((g) => !g.startsWith('!')).map(globTest);
    const exclude = globs.filter((g) => g.startsWith('!')).map((g) => globTest(g.slice(1)));
    const dirs = paths
        .filter((p) => baseOf(p) === 'package.json' && within(p, system))
        .map((p) => rel(dirOf(p), system))
        .filter((d) => d !== '' && include.some((t) => t(d)) && !exclude.some((t) => t(d)))
        .sort(byDepthThenPath)
        .slice(0, MAX_APPS_PER_SYSTEM);
    const apps: DetectedApp[] = [];
    for (const d of dirs) {
        const full = joinPath(system, d);
        const name = manifestProjectName('package.json', (await read(joinPath(full, 'package.json'))) ?? '') ?? baseOf(full);
        apps.push({ path: full, name });
    }
    return apps;
}

/** The first manifest in `folder` that names a project, with its name. */
async function projectOf(folder: string, has: ReadonlySet<string>, read: ReadManifest): Promise<{ name: string } | undefined> {
    for (const m of PROJECT_MANIFESTS) {
        const file = joinPath(folder, m);
        if (!has.has(file)) continue;
        const name = manifestProjectName(file, (await read(file)) ?? '');
        if (name) return { name };
    }
    return undefined;
}

function gitRootsOf(listing: SystemsListing): string[] {
    const roots = new Set<string>((listing.gitRoots ?? []).map(slash));
    for (const raw of listing.paths) {
        const segments = slash(raw).split('/');
        const at = segments.indexOf('.git');
        if (at >= 0) roots.add(segments.slice(0, at).join('/'));
    }
    return [...roots].sort(byDepthThenPath);
}

export async function detectSystems(listing: SystemsListing, readManifest: ReadManifest): Promise<DetectedSystems> {
    const paths = [...new Set(listing.paths.map(slash))].filter((p) => p && !p.split('/').includes('.git')).sort();
    const has = new Set(paths);
    const reads = new Map<string, Promise<string | undefined>>();
    const read: ReadManifest = (p) => {
        let r = reads.get(p);
        if (!r) reads.set(p, (r = readManifest(p).catch(() => undefined)));
        return r;
    };
    const chosen: Array<{ path: string; hasGit: boolean; manifestName?: string }> = [];
    const inside = (p: string): boolean => chosen.some((s) => within(p, s.path));

    const gits = gitRootsOf(listing);
    if (gits.includes('')) {
        chosen.push({ path: '', hasGit: true });
    } else {
        for (const g of gits) if (!inside(g)) chosen.push({ path: g, hasGit: true });
        const candidates = paths.filter((p) => PROJECT_MANIFESTS.includes(baseOf(p))).map(dirOf);
        for (const dir of [...new Set(candidates)].sort(byDepthThenPath)) {
            // A folder holding a repository is not itself a project; a folder in a system is part of it.
            if (inside(dir) || chosen.some((s) => within(s.path, dir))) continue;
            const project = await projectOf(dir, has, read);
            if (project) chosen.push({ path: dir, hasGit: false, manifestName: project.name });
        }
    }
    if (chosen.length === 0) chosen.push({ path: '', hasGit: false });

    const systems: DetectedSystem[] = [];
    for (const s of [...chosen].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
        const manifestName = s.manifestName ?? (await projectOf(s.path, has, read))?.name;
        systems.push({
            path: s.path,
            name: s.path === '' ? listing.rootName : baseOf(s.path),
            hasGit: s.hasGit,
            ...(manifestName ? { manifestName } : {}),
            apps: await appsOf(s.path, paths, has, read),
        });
    }
    return { systems, systemOf: (p) => deepest(systems, p)?.path, appOf: (p) => deepestApp(systems, p) };
}

function deepest(systems: readonly DetectedSystem[], path: string): DetectedSystem | undefined {
    const p = slash(path);
    let best: DetectedSystem | undefined;
    for (const s of systems) if (within(p, s.path) && (!best || s.path.length > best.path.length)) best = s;
    return best;
}
