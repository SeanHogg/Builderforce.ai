/**
 * learnableText — strip a model's REASONING SCRATCHPAD out of an exemplar before it is
 * taught to a project's Evermind.
 *
 * A frontier coder emits its private working-out inside `<think>` blocks and its actual
 * answer outside them. Every text contribution is the assistant's raw turn content, so
 * when a run's reply carried a think block the SSM was adapted on the scratchpad —
 * learning to imitate half-finished deliberation ("<think>The user is right - I should
 * have: 1. Deleted the branch…") as if it were the ANSWER to the user's question.
 * Observed on a real project head: the newest contributions were almost entirely think
 * blocks, several truncated mid-sentence by the 8k transport cap, and the merged model
 * failed its coherence probe.
 *
 * Pure and dependency-free so the single producer entry point can apply it without
 * reaching for env, db or the engine.
 */

/**
 * Reasoning-block delimiters, matched case-insensitively. An UNCLOSED opener counts:
 * the contribution is capped at 8k characters, so a long think block routinely arrives
 * with its closing tag cut off, and treating that as ordinary prose is exactly how
 * truncated scratchpad became training data.
 */
const REASONING_BLOCK = /<(think|thinking|scratchpad|reasoning)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;

/**
 * The answer a reader would have seen — the turn with its reasoning blocks removed.
 * Returns an empty string when the turn was nothing BUT reasoning, which the caller
 * must treat as "there is no answer here to learn" rather than teaching the remains.
 */
export function stripReasoningScratchpad(text: string): string {
  return (text ?? '')
    .replace(REASONING_BLOCK, ' ')
    // Collapse the blank runs the removal leaves behind, so the exemplar reads as the
    // prose it was rather than an answer full of holes.
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
