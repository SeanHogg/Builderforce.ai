/**
 * knowledge/codeEntryPoints.ts — the package entry points a manifest names (PRD 38, Option B+
 * Contract 2). Read ONCE, at review time, from `package.json` `main` / `module` / `bin` /
 * `exports`; the result travels as data (the `entry` badge of the root-level signals), so
 * building a graph — anywhere, from stored output — never reads a file to place a layer.
 */

import type { DirectorySource } from '@seanhogg/builderforce-memory/knowledge';

/** True for a package manifest. */
export const isPackageManifest = (path: string): boolean => path === 'package.json' || path.endsWith('/package.json');

/** Manifests read at most; a monorepo has dozens, never thousands that matter. */
const MAX_MANIFESTS = 200;

/** Entry paths named by package manifests (`main`, `module`, `bin`, `exports` targets), keyed by manifest path. */
export function manifestEntryPaths(manifests: ReadonlyMap<string, string>): Set<string> {
    const out = new Set<string>();
    const collect = (dir: string, value: unknown): void => {
        if (typeof value === 'string') {
            const rel = value.replace(/^\.\//, '');
            if (rel && !rel.startsWith('..')) out.add(dir ? `${dir}/${rel}` : rel);
        } else if (value && typeof value === 'object') {
            for (const v of Object.values(value as Record<string, unknown>)) collect(dir, v);
        }
    };
    for (const [path, text] of manifests) {
        let json: Record<string, unknown>;
        try { json = JSON.parse(text) as Record<string, unknown>; } catch { continue; }
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        for (const key of ['main', 'module', 'bin', 'exports']) collect(dir, json[key]);
    }
    return out;
}

/** Entry points of the package manifests among `ids` (root-relative), read through the review's source. */
export async function readEntryPaths(source: Pick<DirectorySource, 'read'>, ids: Iterable<string>): Promise<Set<string>> {
    const manifests = new Map<string, string>();
    for (const id of [...ids].filter(isPackageManifest).sort().slice(0, MAX_MANIFESTS)) {
        try {
            const doc = await source.read(id);
            if (doc.content.kind === 'text') manifests.set(id, doc.content.text);
        } catch { /* An unreadable manifest names no entry. */ }
    }
    return manifestEntryPaths(manifests);
}
