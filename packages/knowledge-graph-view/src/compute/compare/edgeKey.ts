/**
 * The ONE identity of an edge for a compare: (from, to, kind). `diffGraphs`, `unionGraph` and `restructure` all dedupe
 * and diff by it, so a repeated edge is one and a different kind is another everywhere. Pure and worker-safe.
 */

import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';

/** The separator inside an edge key (a NUL cannot occur in a ref). */
export const EDGE_KEY_SEP = '\u0000';

export const edgeKey = (e: Pick<KEdge, 'from' | 'to' | 'kind'>): string => `${e.from}${EDGE_KEY_SEP}${e.to}${EDGE_KEY_SEP}${e.kind}`;
