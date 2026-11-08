/**
 * packBodies — a pack's EXTR section turned into the bodies the bundle stores (PRD 41 A11 rules 2, 4a, 4b).
 *
 *   - a diff is expanded against the prior body, which is read with ONE `getMany` for the whole pack; a prior the
 *     server lacks, or a diff that does not fit it (positions out of order or range), is `409 prior_missing`, so the
 *     client falls back to sending the body whole;
 *   - an entry is sanitised and clamped (`sanitizeExtracted` + `clampExtracted`) (one line per label, no ref past the bound);
 *   - a hash's stored body is the UNION by `sourceRef` of what is stored and what arrived (`mergeBody`).
 *
 * The merge is a read-modify-write, so it is only valid while nothing else changed those hashes: `basisOf` records the
 * bundle each hash was read from, and the pack's transaction (under the project lock) refuses to commit if any moved.
 */
import { applyEntryDiffs, type PackExtr } from '@seanhogg/builderforce-memory/knowledge/pack';
import { srcRef, type Extracted } from '@seanhogg/builderforce-memory/knowledge';
import type { ExtractedCachePort } from '../knowledgePorts';
import { mergeBody } from '../knowledgeBundles';
import { lostRefsOf, type LostBody } from '../knowledgeHeal';
import type { KnowledgeLedgerPort } from '../knowledgeLedger';
import { clampExtracted, sanitizeExtracted } from '../knowledgePrivacy';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { KnowledgeSyncError } from './knowledgeSyncPorts';

/** The stored bodies of `hashes`: one call when the cache can, else one read each. */
async function storedBodies(extracted: ExtractedCachePort, hashes: readonly string[]): Promise<Map<string, Extracted[]>> {
  if (extracted.getMany) return extracted.getMany(hashes);
  const out = new Map<string, Extracted[]>();
  for (const h of hashes) { const body = await extracted.get(h); if (body) out.set(h, body); }
  return out;
}

/** One body as it is stored: the hash it claims, one line per label, no ref over the graph's bound (see `knowledgePrivacy.ts`). */
function storable(hash: string, entries: readonly Extracted[]): Extracted[] {
  const stray = entries.find((e) => e.sourceHash !== hash);
  if (stray) throw new KnowledgeSyncError(422, 'bad_pack', `extracted output for ${stray.sourceRef} is at hash '${stray.sourceHash}', not the '${hash}' it was sent under`);
  return clampExtracted(sanitizeExtracted(entries).entries);
}

export interface PackBodies {
  /** `entryless`: sources declared to carry no extracted output (see `mergeBody`). */
  bodies: Array<{ hash: string; entries: Extracted[]; entryless: string[] }>;
  /** The bundle key each body's merge started from (null = the hash had no index row). Read BEFORE the bodies. */
  basis: Map<string, string | null>;
  /** Bodies that were unreadable and are rewritten from this pack: the sources they no longer name (see `knowledgeHeal.ts`). */
  lost: LostBody[];
}

export async function buildBodies(
  extracted: ExtractedCachePort, ledger: Pick<KnowledgeLedgerPort, 'index'>, packExtr: readonly PackExtr[], files: ReadonlyArray<{ path: string; hash: string }>, rootId: string,
): Promise<PackBodies> {
  if (packExtr.length === 0) return { bodies: [], basis: new Map(), lost: [] };
  const lost: LostBody[] = [];
  const wanted = [...new Set(packExtr.flatMap((x) => (x.kind === 'diff' ? [x.hash, x.prior] : [x.hash])))];
  // The basis is read FIRST: if the index moves between this read and the bodies', the check at commit only ever errs towards a retry.
  const locations = await ledger.index.locate(wanted);
  const located = new Map(locations.map((l) => [l.hash, l.bundleKey] as const));
  const locOf = new Map(locations.map((l) => [l.hash, l] as const));
  const basis = new Map(packExtr.map((x) => [x.hash, located.get(x.hash) ?? null] as const));
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
    // An EXPLICIT empty body is the client saying nothing was extracted for these files (binary): recorded apart from real entries.
    // An index row whose stored body cannot be read (a missing object or range) is HEALED, not wedged on: the arrival is written on its own,
    // with an index row naming only its sources. Other roots' pairs for this hash then answer "not held", and the pack's transaction
    // invalidates those roots' file leaves (`invalidateLostBodies`) so their next sync reconciles and sends the body again.
    const unreadable = locOf.has(x.hash) && !stored.has(x.hash);
    if (unreadable) {
      reportCaughtError(new Error(`knowledge: the stored body of ${x.hash} could not be read; rewritten from the pack`), {
        source: 'application/knowledge/sync/packBodies.ts', operation: 'healUnreadableBody', level: 'warning', context: { hash: x.hash },
      });
    }
    const declared = x.kind === 'full' && x.entries.length === 0 ? files.filter((f) => f.hash === x.hash).map((f) => srcRef(rootId, f.path)) : [];
    const merged = mergeBody(unreadable ? undefined : locOf.get(x.hash), stored.get(x.hash), storable(x.hash, entries), declared);
    // The sources the old row named and the rewritten one does not: their roots must send the body again (`invalidateLostBodies`).
    if (unreadable) lost.push({ hash: x.hash, refs: lostRefsOf(locOf.get(x.hash)!, merged) });
    return { hash: x.hash, ...merged };
  });
  return { bodies: bodies.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0)), basis, lost };
}
