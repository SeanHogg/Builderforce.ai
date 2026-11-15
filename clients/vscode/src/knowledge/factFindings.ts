/**
 * The registry of each root's fact index (PRD 41 §B5) while its background indexer runs (`indexHostPorts.ts`). A run delta's
 * sides read it (`runDelta/sideFacts.ts`: which files are router modules). The knowledge view's findings are NOT drawn from it:
 * memory's and the code pack's rules run inside the graph build, in the graph worker (`graphWorker.ts`).
 */

import type { FactIndex } from "./factIndex";

const indexes = new Map<string, FactIndex>();

/** The root's fact index while its background indexer runs. */
export function registerFactIndex(rootId: string, index: FactIndex): () => void {
  indexes.set(rootId, index);
  return () => { if (indexes.get(rootId) === index) indexes.delete(rootId); };
}

export const factIndexOf = (rootId: string): FactIndex | undefined => indexes.get(rootId);
