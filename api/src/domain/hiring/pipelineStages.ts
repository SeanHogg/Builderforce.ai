/**
 * The ATS stage vocabulary — ONE place, because a stage name is a contract.
 *
 * ── WHY A DOMAIN MODULE AND NOT A COLUMN OF CONSTANTS ────────────────────────────
 * `job_pipeline_entries.stage` is a free-form varchar on purpose: `hiringFunnel.ts`
 * says it plainly — "a pipeline's stages are free-form by design: every tenant renames
 * them", which is why the funnel infers stage ORDER from the data instead of a lookup.
 * That freedom is correct for READING and dangerous for WRITING: something has to decide
 * what "advance" means, what a rejection is called, and which stage an accepted offer
 * lands in, and if the route decides it once and the board decides it again then a
 * decision recorded by an API client and one recorded by a click end up in two different
 * columns of the same funnel.
 *
 * So the DEFAULT ladder and every transition on it live here, pure, with no database and
 * no Drizzle import. A tenant that renames its stages keeps working — `orderedStages`
 * folds whatever the pipeline actually contains into the ladder rather than replacing it
 * — but "advance" has exactly one meaning in the product, and it is written down once.
 *
 * ── PURE ON PURPOSE ──────────────────────────────────────────────────────────────
 * Everything here is a total function of its arguments. It is the half of the pipeline
 * that can be tested without a Postgres, and it is imported by the application service,
 * by the route's validation and by the tests — three consumers that would otherwise each
 * have grown their own copy of "what comes after screen".
 */

/**
 * The house ladder, in order.
 *
 * Six stages, not four: `debrief` exists because the gap between the last interview and
 * the decision is where candidates are actually lost, and a funnel that cannot see that
 * gap reports the loss against `interview` and sends a recruiter to fix the wrong thing.
 */
export const DEFAULT_PIPELINE_STAGES = ['applied', 'screen', 'interview', 'debrief', 'offer', 'hired'] as const;

export type DefaultPipelineStage = typeof DEFAULT_PIPELINE_STAGES[number];

/** Where an application enters. */
export const ENTRY_STAGE: DefaultPipelineStage = DEFAULT_PIPELINE_STAGES[0];

/** The stage an offer sits in while it is out. */
export const OFFER_STAGE: DefaultPipelineStage = 'offer';

/** The terminal WIN. */
export const HIRED_STAGE: DefaultPipelineStage = 'hired';

/**
 * The terminal LOSS, deliberately NOT a member of the ladder.
 *
 * A rejection is not a later stage — putting it in the ordered list would make the funnel
 * draw it as the step after `hired`, and would make "advance" from `offer` mean "reject".
 * It is a sink: reachable from anywhere, ordered after nothing.
 */
export const REJECTED_STAGE = 'rejected';

/** The stages that end a candidate's run through a pipeline. */
export const TERMINAL_STAGES: readonly string[] = [HIRED_STAGE, REJECTED_STAGE];

/** `job_pipeline_entries.stage` is varchar(48); a longer value would be truncated by
 *  Postgres into a stage name that no longer equals the one the caller sent. */
const MAX_STAGE_LENGTH = 48;

/**
 * A stage name as it is stored: trimmed, lower-cased, bounded.
 *
 * Case-folded because `Screen` and `screen` are one stage to a recruiter and two columns
 * to a `GROUP BY`. Returns `null` rather than a fallback for input that is not a stage at
 * all, so a caller has to decide what to do about it instead of silently filing a
 * candidate under an empty string.
 */
export function normalizeStage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase().slice(0, MAX_STAGE_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The pipeline a posting's candidates move through.
 *
 * One pipeline per posting, addressed BY the posting — not a separate pipeline entity
 * with its own id and its own way of getting out of step with the requisition it exists
 * to fill. `job_pipeline_entries.pipeline_ref` is varchar(64) and a posting id is
 * varchar(36), so the identity fits without a hash or a prefix that would have to be
 * parsed back off.
 */
export function pipelineRefForPosting(jobPostingId: string): string {
  return jobPostingId.trim().slice(0, 64);
}

/** The decisions `hiring_decisions.decision` records, as the schema documents them. */
export const HIRING_DECISIONS = ['advance', 'reject', 'hold', 'offer', 'hire'] as const;

export type HiringDecision = typeof HIRING_DECISIONS[number];

export function isHiringDecision(value: unknown): value is HiringDecision {
  return typeof value === 'string' && (HIRING_DECISIONS as readonly string[]).includes(value);
}

/**
 * The stages this pipeline actually has, in order.
 *
 * The house ladder first, then any stage the tenant invented, in the order they were
 * first seen. Two rules, both learned from the funnel: a renamed pipeline must not lose
 * its stages, and an unknown stage must not be dropped — a candidate sitting in a stage
 * the board does not draw is a candidate nobody is working.
 */
export function orderedStages(observed: readonly string[] = []): string[] {
  const ordered: string[] = [...DEFAULT_PIPELINE_STAGES];
  const seen = new Set<string>(ordered);
  for (const raw of observed) {
    const stage = normalizeStage(raw);
    // The rejection sink is appended last by `boardStages`, never in first-seen order:
    // it is not a step of the ladder and must not be drawn as one.
    if (!stage || stage === REJECTED_STAGE || seen.has(stage)) continue;
    seen.add(stage);
    ordered.push(stage);
  }
  return ordered;
}

/** The columns a board draws: the ladder, then the rejection sink at the end. */
export function boardStages(observed: readonly string[] = []): string[] {
  return [...orderedStages(observed), REJECTED_STAGE];
}

/** The stage after `current`, or `null` at the end of the ladder (and for the sinks). */
export function nextStage(current: string, observed: readonly string[] = []): string | null {
  const stages = orderedStages(observed);
  const index = stages.indexOf(current);
  if (index === -1) return null;
  return stages[index + 1] ?? null;
}

/** The stage before `current`, or `null` at the head of the ladder. */
export function previousStage(current: string, observed: readonly string[] = []): string | null {
  const stages = orderedStages(observed);
  const index = stages.indexOf(current);
  if (index <= 0) return null;
  return stages[index - 1] ?? null;
}

/**
 * Where a decision PUTS the candidate — the reason recording one is not a second click.
 *
 * A recruiter who has just written down why they are rejecting somebody has already made
 * the move; asking them to also drag the card is asking them to do it twice, and the
 * second half is the half that gets skipped, which is how a funnel comes to disagree with
 * the decisions underneath it.
 *
 * `null` means "stay where you are": `hold` is a real answer that deliberately does not
 * move anyone, and an `advance` from the final stage has nowhere to go.
 */
export function stageAfterDecision(
  decision: HiringDecision,
  currentStage: string,
  observed: readonly string[] = [],
): string | null {
  switch (decision) {
    case 'advance':
      return nextStage(currentStage, observed);
    case 'reject':
      return REJECTED_STAGE;
    case 'offer':
      return OFFER_STAGE;
    case 'hire':
      return HIRED_STAGE;
    case 'hold':
      return null;
  }
}

/**
 * Whole days an entry spent in its stage, for `job_pipeline_entries.days_in_stage`.
 *
 * Rounded rather than floored: a candidate who sat for 23 hours spent a day in that
 * stage, and flooring reports a queue as instant precisely when it is at its most
 * congested. Never negative — a clock that went backwards is not evidence of a stage
 * that took less than no time.
 */
export function daysInStage(enteredAt: Date, exitedAt: Date): number {
  return Math.max(0, Math.round((exitedAt.getTime() - enteredAt.getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Interview kits — the TEMPLATE half of the same vocabulary
// ---------------------------------------------------------------------------

/**
 * What a kit stage IS, as `interview_kit_stages.kind` documents it.
 *
 * A kit's stage kinds and a pipeline's stage names are deliberately different lists. A
 * pipeline stage is where a candidate stands and every tenant renames it; a kit stage
 * kind is what actually happens in the room, and that is a fixed vocabulary because the
 * scheduler behaves differently for each — a `take_home` needs no calendars and a `panel`
 * needs several.
 */
export const INTERVIEW_KIT_STAGE_KINDS = ['screen', 'technical', 'panel', 'take_home', 'reference', 'offer'] as const;

export type InterviewKitStageKind = typeof INTERVIEW_KIT_STAGE_KINDS[number];

export function isInterviewKitStageKind(value: unknown): value is InterviewKitStageKind {
  return typeof value === 'string' && (INTERVIEW_KIT_STAGE_KINDS as readonly string[]).includes(value);
}

/**
 * The kit a tenant gets before they have written one.
 *
 * A template with no default is a template nobody uses: the first recruiter to open the
 * kit editor is asked to invent an interview process before they can schedule anything,
 * and what they do instead is schedule nothing and run the interview off a document. So
 * the house process is seeded, tracks the default ladder, and is entirely editable.
 *
 * Pure data — the seeding itself is `application/hiring/interviewKits.ts`.
 */
export const DEFAULT_INTERVIEW_KIT_NAME = 'Standard interview loop';

export interface DefaultKitStage {
  name: string;
  kind: InterviewKitStageKind;
  durationMin: number;
  guidance: string;
  /** The dimensions this stage scores on, and their weights. */
  scorecard: Array<{ key: string; label: string; weight: number }>;
}

export const DEFAULT_INTERVIEW_KIT_STAGES: readonly DefaultKitStage[] = [
  {
    name: 'Recruiter screen',
    kind: 'screen',
    durationMin: 30,
    guidance: 'Confirm the basics: motivation, availability, compensation range and right to work. Nothing here is an assessment of skill.',
    scorecard: [
      { key: 'motivation', label: 'Motivation for this role', weight: 1 },
      { key: 'communication', label: 'Communication', weight: 1 },
      { key: 'logistics', label: 'Availability and expectations align', weight: 1 },
    ],
  },
  {
    name: 'Technical deep dive',
    kind: 'technical',
    durationMin: 60,
    guidance: 'One real problem from the work this person would actually do. Score the reasoning, not the syntax.',
    scorecard: [
      { key: 'depth', label: 'Depth in the core skill', weight: 2 },
      { key: 'problem_solving', label: 'Problem solving', weight: 2 },
      { key: 'craft', label: 'Craft and judgement', weight: 1 },
    ],
  },
  {
    name: 'Team panel',
    kind: 'panel',
    durationMin: 45,
    guidance: 'The people who will work with them. Collaboration and disagreement, on a concrete example rather than a hypothetical.',
    scorecard: [
      { key: 'collaboration', label: 'Collaboration', weight: 2 },
      { key: 'ownership', label: 'Ownership', weight: 1 },
    ],
  },
];
