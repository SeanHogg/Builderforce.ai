/**
 * knowledge/codeNodes.ts — the code pack's vocabulary: its id, its badges, and the ONE
 * file-node / Extracted builder every code extractor shares (the per-file parser, the
 * repo-map converter and the analyzer converter), so a file is described the same way
 * whichever of them saw it.
 *
 * Pure: no I/O. Worker-safe.
 */

import { canonicalJson, srcRef, type Extracted, type KEdge, type KNode, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { areaOfPath } from '@seanhogg/builderforce-memory/working';
import { hashText } from '@seanhogg/builderforce-memory/ingest';

export const CODE_PACK_ID = 'code';

/** Badges the code pack puts on file nodes. */
export const CODE_BADGES = {
    /** The symbol extractor's language family (`js`, `python`, …). */
    language: 'language',
    /** Definitions in the file. */
    symbols: 'symbols',
    /** Exported definitions in the file. */
    exports: 'exports',
    /** knip: `'file'` when the whole file is unused. */
    unused: 'unused',
    /** knip: unused exports in the file. */
    unusedExports: 'unusedExports',
    /** knip: unused dependencies declared by the file (a package manifest). */
    unusedDependencies: 'unusedDependencies',
} as const;

/**
 * Prefix of the `sourceHash` of ROOT-level output (repo graph, analyzers). Memory's
 * `buildGraph` keeps the first node it sees per ref, ordering Extracted by
 * (sourceRef, sourceHash): `~` sorts after every hex content hash, so the per-file
 * parser's node — the one carrying the file's real content hash — always wins, and the
 * root-level output only adds edges and badges.
 */
export const ROOT_OUTPUT_HASH_PREFIX = '~';

const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** A code `file` node. `sourceHash` only from the per-file parser (see {@link ROOT_OUTPUT_HASH_PREFIX}). */
export function codeFileNode(
    rootId: string,
    path: string,
    opts: { sourceHash?: string; badges?: Record<string, number | string> } = {},
): KNode {
    const area = areaOfPath(path);
    const badges = opts.badges && Object.keys(opts.badges).length > 0 ? opts.badges : undefined;
    return {
        ref: srcRef(rootId, path), kind: 'file', label: basenameOf(path) || path, pack: CODE_PACK_ID,
        ...(area ? { area: srcRef(rootId, area) } : {}),
        importance: 0, origin: 'extracted',
        ...(opts.sourceHash ? { sourceHash: opts.sourceHash } : {}),
        ...(badges ? { badges } : {}),
    };
}

/**
 * Root-level output for one file: its node plus outgoing edges, with a `sourceHash` that
 * is a pure function of the content (`~<tag>:<hash>`), so equal analyzer output gives an
 * equal graph digest whatever run produced it.
 */
export function rootLevelExtracted(tag: string, node: KNode, edges: KEdge[]): Extracted {
    const sourceRef: NodeRef = node.ref;
    const body = { nodes: [node], edges, keys: [] as Extracted['keys'] };
    return { sourceRef, sourceHash: `${ROOT_OUTPUT_HASH_PREFIX}${tag}:${hashText(canonicalJson(body))}`, ...body };
}

export { basenameOf };
