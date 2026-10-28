/**
 * knowledge/rootId.ts — THE root-id rule (PRD 38 §4.2, `knowledge_scopes.root_id`):
 * `${host}:${repoId or folder id}` for a reviewed root, `${host}:${repoId or folder id}:${path}`
 * for a folder inside it. Every host derives its ids here — VS Code, on-prem and the
 * browser (`hostRootId` in `@builderforce/knowledge-browser`) — so two checkouts with the
 * same folder name never share a scope, and the same checkout keeps its id however the
 * folder is named on disk.
 *
 *   - `repoId` — the checkout's git remote, normalised ({@link repoIdOfRemote}), when there is one;
 *   - `folderId` — otherwise a stable id of the folder itself: a host-readable id (the
 *     browser's `upload:<name>`) or a hash of its URI / container path ({@link folderIdOf}).
 *
 * Pure (Worker-safe): the host reads its remote and folder; this only composes.
 */

import { sha256Hex } from '@seanhogg/builderforce-memory/knowledge';

export interface RootIdParts {
    /** Who can re-read the root: `vscode`, `onprem`, `web`, `rovr`. */
    host: string;
    /** The checkout's normalised git remote ({@link repoIdOfRemote}); wins over `folderId`. */
    repoId?: string | undefined;
    /** The folder's own stable id, used when there is no `repoId`. */
    folderId: string;
    /** Root-relative folder reviewed inside it; '' / absent = the root itself. */
    path?: string | undefined;
}

const cleanPath = (p: string): string => p.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
/** A part never ends in ':' nor holds '::' — `src:${rootId}::${path}` must split unambiguously. */
const cleanPart = (s: string): string => s.replace(/:{2,}/g, ':').replace(/:+$/, '');

export function rootIdFor({ host, repoId, folderId, path }: RootIdParts): string {
    const id = cleanPart(repoId?.trim() || folderId);
    const rel = path ? cleanPart(cleanPath(path)) : '';
    return rel ? `${host}:${id}:${rel}` : `${host}:${id}`;
}

/**
 * The root-relative path of a source ref, given the root it belongs to. Prefix-aware, so it
 * holds for any root id a client sends — even one ending in ':' that a first-`::` split
 * would misread. Undefined when `ref` is not a source ref of `rootId`.
 */
export function sourcePathOf(ref: string, rootId: string): string | undefined {
    const prefix = `src:${rootId}::`;
    return ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
}

/** The root id of a source ref (`src:<rootId>::<path>`) whose root came from {@link rootIdFor}. */
export function rootIdOfSourceRef(ref: string): string | undefined {
    if (!ref.startsWith('src:')) return undefined;
    const end = ref.indexOf('::', 4);
    return end > 4 ? ref.slice(4, end) : undefined;
}

/**
 * The folder path of `rootId` inside the root `baseId`: '' for the root itself, the
 * relative path for a folder inside it, undefined when `rootId` is not under `baseId`.
 */
export function rootRelOf(baseId: string, rootId: string): string | undefined {
    if (rootId === baseId) return '';
    return rootId.startsWith(`${baseId}:`) ? rootId.slice(baseId.length + 1) : undefined;
}

/**
 * A git remote as a host-independent repository id: `git@github.com:org/repo.git`,
 * `https://user@github.com:443/org/repo` and `ssh://git@github.com/org/repo` are all
 * `github.com/org/repo`. Undefined for an empty or unusable remote.
 */
export function repoIdOfRemote(remote: string | undefined | null): string | undefined {
    const raw = remote?.trim();
    if (!raw) return undefined;
    let rest = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const scheme = rest !== raw;
    rest = rest.replace(/^[^@/]+@/, '');
    // `host:org/repo` (scp form) vs `host:port/org/repo` (a URL's port).
    rest = scheme ? rest.replace(/^([^/:]+):\d+(?=\/)/, '$1') : rest.replace(/^([^/:]+):(?!\/)/, '$1/');
    const [host = '', ...segments] = rest.split('/');
    const tail = segments.join('/').replace(/\.git\/?$/i, '').replace(/\/+$/, '').replace(/:+/g, '/');
    const id = [host.toLowerCase(), tail].filter(Boolean).join('/');
    return id && tail ? id : undefined;
}

/** A stable id of a folder with no remote: a short hash of its URI or path. */
export function folderIdOf(identity: string): string {
    return `f-${sha256Hex(identity).slice(0, 16)}`;
}
