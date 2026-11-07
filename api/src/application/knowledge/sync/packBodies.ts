/**
 * packBodies — a pack's EXTR section turned into the bodies the bundle stores (PRD 41 A11 rules 2, 4a, 4b).
 *
 *   - a diff is expanded against the prior body, which is read with ONE `getMany` for the whole pack; a prior the
 *     server lacks, or a diff that does not fit it (positions out of order or range), is `409 prior_missing`, so the
 *     client falls back to sending the body whole;
 *   - an entry is sanitised and clamped exactly as `putExtracted` does (one line per label, no ref past the bound);
 *   - a hash's stored body is the UNION by `sourceRef` of what is stored and what arrived (the arrival wins for the
 *     same ref), so two roots that share a content hash never evict each other's entries.
 */
import { applyEntryDiffs, type PackExtr } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { Extracted } from '@seanhogg/builderforce-memory/knowledge';
import type { ExtractedCachePort } from '../knowledgePorts';
import { clampExtracted, sanitizeExtracted } from '../knowledgePrivacy';
import { KnowledgeSyncError } from './knowledgeSyncPorts';

/** The stored bodies of `hashes`: one call when the cache can, else one read each. */
async function storedBodies(extracted: ExtractedCachePort, hashes: readonly string[]): Promise<Map<string, Extracted[]>> {
  if (extracted.getMany) return extracted.getMany(hashes);
  const out = new Map<string, Extracted[]>();
  for (const h of hashes) { const body = await extracted.get(h); if (body) out.set(h, body); }
  return out;
}

/** One body as it is stored: the hash it claims, one line per label, no ref over the graph's bound (see `putExtracted`). */
function storable(hash: string, entries: readonly Extracted[]): Extracted[] {
  const stray = entries.find((e) => e.sourceHash !== hash);
  if (stray) throw new KnowledgeSyncError(422, 'bad_pack', `extracted output for ${stray.sourceRef} is at hash '${stray.sourceHash}', not the '${hash}' it was sent under`);
  return clampExtracted(sanitizeExtracted(entries).entries);
}

/** Entries of `stored` whose source the arrival does not restate, then the arrival: the union by `sourceRef`. */
export function mergeBodies(stored: readonly Extracted[] | undefined, arrival: readonly Extracted[]): Extracted[] {
  const arrived = new Set(arrival.map((e) => e.sourceRef));
  return [...(stored ?? []).filter((e) => !arrived.has(e.sourceRef)), ...arrival];
}

export async function buildBodies(extracted: ExtractedCachePort, packExtr: readonly PackExtr[]): Promise<Array<{ hash: string; entries: Extracted[] }>> {
  if (packExtr.length === 0) return [];
  const wanted = [...new Set(packExtr.flatMap((x) => (x.kind === 'diff' ? [x.hash, x.prior] : [x.hash])))];
  const stored = await storedBodies(extracted, wanted);
  const bodies = packExtr.map((x) => {
    let entries: Extracted[];
    if (x.kind === 'full') entries = x.entries;
    else {
      const prior = stored.get(x.prior);
      if (!prior) throw new KnowledgeSyncError(409, 'prior_missing', `the server does not hold the prior extraction ${x.prior}`, { prior: x.prior });
      try {
        entries = applyEntryDiffs(prior, x.entries);
      } catch (error) {
        throw new KnowledgeSyncError(409, 'prior_missing', error instanceof Error ? error.message : 'the prior extraction does not fit', { prior: x.prior });
      }
    }
    return { hash: x.hash, entries: mergeBodies(stored.get(x.hash), storable(x.hash, entries)) };
  });
  return bodies.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
}
