/**
 * PostmortemWhyService — the 5-Why ladder behind an incident's RCA.
 *
 * WHAT WAS BROKEN. The post-mortem collected `rootCause` / `contributingFactors` /
 * `whatWentWrong` as free text, and the incidents surface rendered a fishbone by
 * splitting those blobs on newlines. That produces a LIST of causes, and a 5-Why is
 * not a list: its entire content is the ORDER, because why₂ is an answer to why₁.
 * Once the lines are a bag nothing downstream can tell a causal chain from a
 * brainstorm — the same five sentences written in the opposite order are byte-identical
 * to the reader. The chain therefore gets rows (`postmortem_whys`, migration 1072),
 * one per step, with the ordinal stored rather than inferred from line position.
 *
 * WHY A WHOLE-CHAIN WRITE AND NOT PER-STEP CRUD. A ladder is only valid as a unit:
 * removing why₃ makes why₄ an answer to a question nobody asked. Per-step endpoints
 * would let a client leave the chain in exactly that state between two requests, and
 * `step_no` would need a renumbering pass on every delete anyway. `replaceChain`
 * takes the ladder the user is looking at and makes the stored one equal to it, so
 * the contiguous-from-1 invariant holds by construction instead of by cleanup.
 *
 * Data access sits in this service rather than a repository class on purpose: its
 * siblings in this subsystem (IncidentService / OnCallService / EscalationService)
 * all own their tables directly, and a lone repository for one table would mean two
 * conventions for the same bounded context.
 */
import { and, asc, eq } from 'drizzle-orm';
import { postmortemWhys, prodIncidents } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { IncidentService } from './IncidentService';
import type { Db } from '../../infrastructure/database/connection';

/**
 * The ladder cap. Five is the technique's name and the convention the UI defaults
 * to; seven is the hard ceiling, because past that the steps stop being causes and
 * start being a narrative — and an unbounded chain is also an unbounded write.
 */
export const MAX_WHY_STEPS = 7;
/** What the capture UI opens with, and what "5-Why" means to the people using it. */
export const CONVENTIONAL_WHY_STEPS = 5;
/** Per-step text cap — a why is a sentence, not the post-mortem document. */
const MAX_STATEMENT_LEN = 1000;

export interface WhyStepInput {
  statement: string;
  /** Marks the terminal step as THE root cause. Only honoured on the last step. */
  isRoot?: boolean;
}

export interface WhyStep {
  id: string;
  stepNo: number;
  statement: string;
  isRoot: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** A chain as normalised for storage: contiguous from step 1, at most one root. */
export interface NormalisedWhyStep {
  stepNo: number;
  statement: string;
  isRoot: boolean;
}

/**
 * Normalise a submitted ladder: trim, drop blanks, cap, renumber from 1, and move
 * the root flag to the terminal step (or drop it entirely).
 *
 * The root rule is the substantive one. A step with another step BELOW it has been
 * answered by that step, so it is by definition not where the asking stopped —
 * honouring a root flag there would persist a chain claiming both "this is the
 * cause" and "and here is its cause", which is the contradiction the partial-unique
 * index and every downstream consumer would then have to arbitrate. Flags on
 * non-terminal steps are dropped rather than rejected because a user editing a
 * saved chain reorders and inserts constantly, and a hard error mid-edit teaches
 * them to stop capturing chains at all.
 *
 * Pure and exported so the invariant is unit-tested without a database.
 */
export function normaliseWhyChain(steps: readonly WhyStepInput[]): NormalisedWhyStep[] {
  const kept = steps
    .map((s) => ({ statement: String(s?.statement ?? '').trim().slice(0, MAX_STATEMENT_LEN), isRoot: s?.isRoot === true }))
    .filter((s) => s.statement.length > 0)
    .slice(0, MAX_WHY_STEPS);
  const anyRoot = kept.some((s) => s.isRoot);
  return kept.map((s, i) => ({
    stepNo: i + 1,
    statement: s.statement,
    // Only the terminal step can carry the flag, and it carries it if ANY step was
    // flagged — a user who marked step 3 as root and then appended step 4 meant
    // "the chain bottoms out", not "forget the root entirely".
    isRoot: anyRoot && i === kept.length - 1,
  }));
}

/** The step the remediation attaches to: the flagged root, else null. */
export function rootStatement(chain: readonly NormalisedWhyStep[]): string | null {
  return chain.find((s) => s.isRoot)?.statement ?? null;
}

export class PostmortemWhyService {
  constructor(private readonly db: Db) {}

  /** Fail closed on an incident from another workspace before touching its chain. */
  private async assertIncident(tenantId: number, incidentId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: prodIncidents.id })
      .from(prodIncidents)
      .where(scopedToTenant(prodIncidents, tenantId, eq(prodIncidents.id, incidentId)))
      .limit(1);
    if (!row) throw new Error('Incident not found in workspace');
  }

  /** The stored ladder for an incident, in depth order. */
  async listChain(tenantId: number, incidentId: string): Promise<WhyStep[]> {
    const rows = await this.db
      .select({
        id: postmortemWhys.id,
        stepNo: postmortemWhys.stepNo,
        statement: postmortemWhys.statement,
        isRoot: postmortemWhys.isRoot,
        createdAt: postmortemWhys.createdAt,
        updatedAt: postmortemWhys.updatedAt,
      })
      .from(postmortemWhys)
      .where(scopedToTenant(postmortemWhys, tenantId, eq(postmortemWhys.incidentId, incidentId)))
      .orderBy(asc(postmortemWhys.stepNo));
    return rows;
  }

  /**
   * Make the stored ladder equal to `steps`. Delete-then-insert rather than a diff:
   * the rows are a handful, the ordinals shift on any insertion, and a diff would
   * have to reproduce the contiguity rule that {@link normaliseWhyChain} already owns.
   *
   * Not wrapped in a transaction — the platform runs on neon-http, which has none.
   * The window is a chain briefly missing rather than a chain silently wrong, and
   * the next write restores it; a partially-renumbered chain would not self-heal.
   *
   * When the terminal step is marked as the root, the incident's `rootCause` is
   * updated THROUGH IncidentService so the board-task mirror and the single-writer
   * rule for `prod_incidents` both still hold.
   */
  async replaceChain(
    tenantId: number,
    incidentId: string,
    steps: readonly WhyStepInput[],
    opts: { actorRef?: string | null; createdBy?: string | null } = {},
  ): Promise<WhyStep[]> {
    await this.assertIncident(tenantId, incidentId);
    const chain = normaliseWhyChain(steps);

    await this.db.delete(postmortemWhys).where(and(
      eq(postmortemWhys.tenantId, tenantId),
      eq(postmortemWhys.incidentId, incidentId),
    ));
    if (chain.length) {
      await this.db.insert(postmortemWhys).values(chain.map((s) => ({
        tenantId,
        incidentId,
        stepNo: s.stepNo,
        statement: s.statement,
        isRoot: s.isRoot,
        createdBy: opts.createdBy ?? null,
      })));
    }

    const root = rootStatement(chain);
    if (root) {
      await new IncidentService(this.db).updateIncident(tenantId, incidentId, {
        rootCause: root,
        actorRef: opts.actorRef ?? null,
      });
    }

    // One timeline entry per chain write, not per step: the ladder is the unit of
    // work, and a per-step feed would bury the incident's real events.
    await new IncidentService(this.db).addEvent(tenantId, incidentId, {
      kind: 'note',
      actorRef: opts.actorRef ?? 'system',
      message: chain.length
        ? `5-Why chain updated — ${chain.length} step(s)${root ? `, root cause: ${root.slice(0, 160)}` : ''}`
        : '5-Why chain cleared',
    });

    return this.listChain(tenantId, incidentId);
  }
}
