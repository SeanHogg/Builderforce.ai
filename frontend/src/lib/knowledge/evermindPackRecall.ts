/**
 * An Evermind's run-time retrieval over its selected knowledge packs (PRD 40): the canvas
 * turn's Evermind recall (the project's learned memories) with the cards of the packs the
 * Evermind node chose merged in. The packs are retrieved through THE seam —
 * `withPacks(primary, registry, port)` — over the browser registry/port
 * (`@builderforce/knowledge-browser`), restricted to the node's `knowledgePacks`; the cards
 * ride the recall as extra items, so the existing memory block and trace carry them.
 *
 * Best-effort like the recall it wraps: a pack that cannot be read is skipped, never a failed turn.
 */

import type { EvermindRecallResult } from '@seanhogg/builderforce-brain-embedded';
import { hitLine, withPacks } from '@builderforce/agent-tools/knowledge-index';
import {
  browserPackRegistry, browserPackRetrieval, selectedPackRegistry, type PackClient,
} from '@builderforce/knowledge-browser';
import { recordedFailure } from '@/lib/reportError';

/** Cards fetched from the selected packs for one question. */
const PACK_RECALL_K = 6;

/** The pack root ids an Evermind node selected (`data.knowledgePacks`), tolerant of any stored shape. */
export function selectedPacksOf(data: { knowledgePacks?: unknown }): string[] {
  const raw = data.knowledgePacks;
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
}

/** The packs chosen by the board's Evermind node(s) of `projectId` (`resourceId` = `evermind:<id>`), de-duplicated. */
export function selectedPacksForProject(nodes: ReadonlyArray<{ data: { kind?: unknown; resourceId?: unknown; knowledgePacks?: unknown } }>, projectId: number): string[] {
  const resource = `evermind:${projectId}`;
  return [...new Set(nodes.filter((n) => n.data.kind === 'evermind' && n.data.resourceId === resource).flatMap((n) => selectedPacksOf(n.data)))];
}

type Recaller = (query: string) => Promise<EvermindRecallResult | null>;

/**
 * `recall` with the selected packs' cards appended as memory items (negative ids: they are
 * not learned memories, so nothing targets them). The base recall is returned untouched when
 * no pack is selected or nothing matched.
 */
export function withEvermindPacks(base: Recaller, packs: { client: PackClient; selected: readonly string[] }): Recaller {
  if (packs.selected.length === 0) return base;
  const index = withPacks(undefined, selectedPackRegistry(browserPackRegistry(packs.client), packs.selected), browserPackRetrieval(packs.client));
  return async (query) => {
    const [memory, cards] = await Promise.all([
      base(query),
      index.recall(query, { k: PACK_RECALL_K }).catch(recordedFailure('Recalling the selected knowledge packs', undefined)),
    ]);
    if (!cards || cards.hits.length === 0) return memory;
    const items = cards.hits.map((hit, i) => ({
      id: -(i + 1),
      text: hitLine(hit).replace(/^- /, ''),
      score: Math.min(1, Math.max(0, hit.score)),
    }));
    return {
      seeded: memory?.seeded ?? false,
      version: memory?.version ?? 0,
      mode: memory?.mode ?? 'connected',
      ...(memory?.tiers ? { tiers: memory.tiers } : {}),
      items: [...(memory?.items ?? []), ...items],
    };
  };
}
