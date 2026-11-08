/**
 * backlogDispositionRules — PRD 23 §6: the evidence rules that give every non-Done ticket a
 * keep / close / consolidate / quarantine disposition. PURE (no I/O) so the rules are the
 * unit under test; `backlogDispositionPass.ts` loads the evidence and persists the result.
 *
 * NOTHING HERE NAMES A TICKET NUMBER. The PRD's audited examples (#386, #542/#543, the seven
 * closed-PR-only tickets, the #1496-#1523 clusters) must fall out of the rules:
 *
 *   1. CLOSE      the ticket's own text retracts it ("retracted", "hallucinated", "withdrawn")
 *                 or says it was superseded ("closed and superseded", "superseded by #N").
 *   2. KEEP       a merged PR exists: the outcome shipped, so it is not abandoned, and it is
 *                 not closed either - it needs acceptance evidence, not a cancel.
 *   3. CONSOLIDATE it is a near-duplicate (token-set similarity) of an older surviving ticket
 *                 in the same project and type, and has no open PR of its own. The oldest
 *                 ticket of a cluster is the canonical one and is kept.
 *   4. QUARANTINE every PR it has is closed and unmerged, OR it is too vague to act on (no
 *                 acceptance criteria and no PR) - a bounded human decision queue (§6.4).
 *   5. KEEP       otherwise.
 *
 * Rule order matters and is the policy: retraction beats duplication beats quarantine, and a
 * shipped ticket is never closed or consolidated away.
 */

export type DispositionKind = 'keep' | 'close' | 'consolidate' | 'quarantine';

export interface TicketPrEvidence {
  id: string;
  number: number | null;
  status: string; // draft | open | merged | closed
  buildStatus: string | null;
}

export interface TicketEvidence {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  status: string;
  taskType: string;
  prs: readonly TicketPrEvidence[];
  /** True when a PRD (task_specs row) is linked to the ticket. */
  hasPrd: boolean;
}

export interface DispositionDecision {
  taskId: number;
  disposition: DispositionKind;
  prdAlignment: 'direct_prd' | 'operational_defect' | 'unlinked';
  deliveryState: 'not_started' | 'implemented_unverified' | 'review' | 'repair' | 'blocked' | 'in_progress';
  /** Why - rule key plus the facts behind it. Stored verbatim as `evidence`. */
  evidence: Record<string, unknown>;
  duplicateOf: number | null;
  supersededBy: number | null;
}

/** Jaccard similarity of title token sets at or above which two tickets are the same work. */
export const DUPLICATE_SIMILARITY = 0.85;
/** Fewer tokens than this is too little to call anything a duplicate. */
const MIN_TOKENS_FOR_DUPLICATE = 3;
/** A description shorter than this (and no PR) carries no acceptance criteria. */
export const MIN_ACTIONABLE_DESCRIPTION = 20;
/** Quadratic duplicate scan bound per project; beyond it the pass reports `duplicateScanTruncated`. */
export const MAX_DUPLICATE_SCAN = 2000;

const RETRACTION = /\b(retract(?:ed|ion)?|hallucinat(?:ed|ion)|withdrawn|false positive)\b/i;
const SUPERSEDED_CLOSED = /\bclosed and superseded\b/i;
const SUPERSEDED_BY = /\bsuperseded by\s+#?(\d+)\b/i;

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'and', 'in', 'on', 'is', 'are', 'be', 'with', 'gap', 'fix', 'add']);

/** Lowercased alphabetic tokens; digits and punctuation drop so "#1496 ... 3 tests" ~ "#1499 ... 5 tests". */
export function titleTokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function deliveryStateOf(t: TicketEvidence): DispositionDecision['deliveryState'] {
  if (t.status === 'blocked') return 'blocked';
  const open = t.prs.filter((p) => p.status === 'open' || p.status === 'draft');
  if (t.prs.some((p) => p.status === 'merged')) return 'implemented_unverified';
  if (open.length) return open.some((p) => p.buildStatus === 'failure') ? 'repair' : 'review';
  return t.status === 'in_progress' || t.status === 'in_review' ? 'in_progress' : 'not_started';
}

function alignmentOf(t: TicketEvidence): DispositionDecision['prdAlignment'] {
  if (t.hasPrd) return 'direct_prd';
  return t.taskType === 'gap' || t.taskType === 'bug' ? 'operational_defect' : 'unlinked';
}

/** The retraction / supersession text found in the ticket, or null. */
export function retractionEvidence(t: TicketEvidence): { rule: string; supersededBy: number | null; match: string } | null {
  const text = `${t.title}\n${t.description ?? ''}`;
  const sup = SUPERSEDED_BY.exec(text);
  if (sup) return { rule: 'superseded', supersededBy: Number(sup[1]), match: sup[0] };
  const closed = SUPERSEDED_CLOSED.exec(text);
  if (closed) return { rule: 'superseded', supersededBy: null, match: closed[0] };
  const ret = RETRACTION.exec(text);
  if (ret) return { rule: 'retracted', supersededBy: null, match: ret[0] };
  return null;
}

/**
 * Compute a disposition for every ticket given. PURE. `knownTaskIds` is the set of ticket
 * ids a `superseded by #N` reference may legitimately point at (same tenant); an unknown
 * reference is recorded in the evidence but not stored as a FK.
 */
export function computeDispositions(
  tickets: readonly TicketEvidence[],
  knownTaskIds: ReadonlySet<number>,
): { decisions: DispositionDecision[]; duplicateScanTruncated: boolean } {
  const byId = new Map<number, DispositionDecision>();
  const survivors: TicketEvidence[] = [];

  const base = (t: TicketEvidence) => ({
    taskId: t.id,
    prdAlignment: alignmentOf(t),
    deliveryState: deliveryStateOf(t),
    duplicateOf: null as number | null,
    supersededBy: null as number | null,
  });

  for (const t of [...tickets].sort((a, b) => a.id - b.id)) {
    const hasMerged = t.prs.some((p) => p.status === 'merged');
    const retraction = retractionEvidence(t);
    if (retraction && !hasMerged) {
      const ref = retraction.supersededBy != null && retraction.supersededBy !== t.id && knownTaskIds.has(retraction.supersededBy)
        ? retraction.supersededBy : null;
      byId.set(t.id, {
        ...base(t), disposition: 'close', supersededBy: ref,
        evidence: { rule: retraction.rule, match: retraction.match, referencedTask: retraction.supersededBy },
      });
      continue;
    }
    survivors.push(t);
  }

  // Duplicate clusters: oldest id first, so the oldest of a cluster is the canonical ticket.
  const scan = survivors.filter((t) => !t.prs.some((p) => p.status === 'merged'));
  const truncated = scan.length > MAX_DUPLICATE_SCAN;
  const tokens = new Map(scan.map((t) => [t.id, titleTokens(t.title)] as const));
  const canonicals: TicketEvidence[] = [];
  const duplicateOf = new Map<number, { canonical: number; similarity: number }>();
  for (const t of scan.slice(0, MAX_DUPLICATE_SCAN)) {
    const tk = tokens.get(t.id)!;
    let hit: { canonical: number; similarity: number } | null = null;
    if (tk.size >= MIN_TOKENS_FOR_DUPLICATE) {
      for (const c of canonicals) {
        if (c.projectId !== t.projectId || c.taskType !== t.taskType) continue;
        const sim = jaccard(tk, tokens.get(c.id)!);
        if (sim >= DUPLICATE_SIMILARITY && (!hit || sim > hit.similarity)) hit = { canonical: c.id, similarity: sim };
      }
    }
    // A ticket with its own open PR is in-flight work: it stays independent.
    const inFlight = t.prs.some((p) => p.status === 'open' || p.status === 'draft');
    if (hit && !inFlight) duplicateOf.set(t.id, hit);
    else canonicals.push(t);
  }

  for (const t of survivors) {
    const dup = duplicateOf.get(t.id);
    if (dup) {
      byId.set(t.id, {
        ...base(t), disposition: 'consolidate', duplicateOf: dup.canonical,
        evidence: { rule: 'duplicate', canonical: dup.canonical, similarity: Number(dup.similarity.toFixed(3)) },
      });
      continue;
    }
    const closedOnly = t.prs.length > 0 && t.prs.every((p) => p.status === 'closed');
    if (closedOnly) {
      byId.set(t.id, {
        ...base(t), disposition: 'quarantine',
        evidence: { rule: 'closed_unmerged_only', prs: t.prs.map((p) => p.number ?? p.id) },
      });
      continue;
    }
    const vague = t.prs.length === 0 && (t.description ?? '').trim().length < MIN_ACTIONABLE_DESCRIPTION;
    if (vague) {
      byId.set(t.id, {
        ...base(t), disposition: 'quarantine',
        evidence: { rule: 'no_acceptance_criteria', descriptionLength: (t.description ?? '').trim().length },
      });
      continue;
    }
    byId.set(t.id, {
      ...base(t), disposition: 'keep',
      evidence: { rule: 'unmet_capability', openPrs: t.prs.filter((p) => p.status === 'open' || p.status === 'draft').length, mergedPrs: t.prs.filter((p) => p.status === 'merged').length },
    });
  }

  return { decisions: tickets.map((t) => byId.get(t.id)!).filter(Boolean), duplicateScanTruncated: truncated };
}
