/**
 * The reflection step: turn a run that WORKED into a procedure the next run follows.
 *
 * The board already decides whether a run produced something real — a merged PR, a
 * green check, changes that survived review. A run that clears that bar has, by
 * definition, executed a procedure that works, and until now that procedure existed
 * only in a transcript nobody reads.
 *
 * It is split in two on purpose, because the two halves know different things at
 * different moments:
 *
 *  - {@link skillReflectionDirective} rides in the run's PROMPT. Only the agent knows
 *    which of the fifty things it did were the repeatable ones, and it knows that at
 *    the moment it is about to finish — not when the prompt was assembled.
 *  - {@link runEarnedReflection} runs at FINALIZE, where merge state and the outcome
 *    score are finally known, and answers the reviewer's question: did this run clear
 *    the bar? That is what makes "a qualifying run proposed nothing" a visible fact
 *    rather than a silence.
 *
 * Either way the agent only ever produces a DRAFT, and only a human makes one binding.
 */

/** What the run achieved. Known at finalize, not at prompt-build time. */
export interface RunReflectionSignals {
  /** The run's work was merged. */
  merged?: boolean;
  /** A pull request was opened for it. */
  prOpened?: boolean;
  /** The run wrote something to the repository. */
  producedChanges?: boolean;
  /** Outcome score for the run, when one has been computed (0–1). */
  score?: number | null;
}

/** Score at or above which a run counts as proof rather than an attempt. */
export const REFLECTION_SCORE_FLOOR = 0.6;

/**
 * Whether this run earned the right to have proposed a skill.
 *
 * Merged work counts on its own. An unmerged run counts only with BOTH real changes
 * and a graded score above the floor — otherwise every run that touched a file would
 * be writing instructions for every other run, which is how a skill catalogue fills
 * with confident nonsense.
 */
export function runEarnedReflection(signals: RunReflectionSignals): boolean {
  if (signals.merged) return true;
  const graded = typeof signals.score === 'number' && signals.score >= REFLECTION_SCORE_FLOOR;
  return Boolean(graded && (signals.producedChanges || signals.prOpened));
}

/**
 * The reflection directive for a run's prompt. Empty for a run with no repository
 * to have learned a procedure about, so the caller injects unconditionally.
 *
 * The wording carries the bar as well as the invitation: most runs should propose
 * nothing, and a step that always fires is a step that always produces noise.
 */
export function skillReflectionDirective(hasRepository: boolean): string {
  if (!hasRepository) return '';
  return [
    '## Reflection — before you finish',
    '',
    'If this run reached a VERIFIED result (your change is merged, or it is committed and its checks pass), the sequence that got you there is evidence rather than a guess.',
    'In that case only: if you worked out a repeatable way to do something non-obvious in this codebase that a future run would otherwise rediscover, call `skill_propose` with the steps, the exact commands, and how to tell it worked. Call `skill_list` first, so you revise an existing draft instead of adding a near-duplicate.',
    '',
    'Do NOT propose a skill for a one-off fix, for something the repository already documents, or for anything you did not actually finish and verify. Proposing nothing is the right answer for most runs.',
    'A proposal is a draft for human review. It changes nothing on its own, and it never replaces doing the task.',
  ].join('\n');
}
