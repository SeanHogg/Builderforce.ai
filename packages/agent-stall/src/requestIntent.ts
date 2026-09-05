/**
 * What a turn is ASKING FOR, and what a turn PROMISED.
 *
 * Three predicates that several surfaces need to agree on, and that were about to
 * be written twice (once in the client's run diagnostics, once in the server's
 * answer cache) with the inevitable drift that follows.
 *
 * They exist because of one concrete failure. A user asked the agent to change a
 * CSS value. The run analysed the problem, ran out of tool budget, and replied
 * "I found the exact issue but hit the tool-call budget before applying the edit —
 * so nothing has been changed on disk yet … Re-run me and I'll apply the edit."
 * That answer was then written to the Q&A cache. The next time the same question
 * was asked, the cache replayed it verbatim: zero tool calls, zero model calls,
 * zero work — and a fresh promise to do the work "next time" that no amount of
 * re-asking could ever fulfil, because every re-ask hit the cache again.
 *
 * Two independent things went wrong there, and each gets a predicate:
 *
 *  - A request to CHANGE something must never be served from a cache at all. Its
 *    answer depends on the state of the world at the moment it runs, and the only
 *    correct response is to do the work. {@link asksForChange}
 *  - An answer that announces work it did not do must never be cached, whatever
 *    the question was — replaying a promise is worse than useless.
 *    {@link promisesUnfinishedWork}
 *
 * The third handles the turn after: the user typed "Fix". A bare directive like
 * that carries no content of its own — it points at the preceding turn — and an
 * agent that reads it in isolation asks "fix what?" while the answer sits one
 * message above. {@link isContinuationDirective}
 *
 * All three are pure string predicates: no clock, no I/O, no model.
 */

/**
 * Verbs that demand an EFFECT on the world rather than an explanation of it.
 * Deliberately verb-led and narrow — every entry here is something that changes
 * state, so a false positive requires the user to have used an action verb about
 * a non-action.
 */
const CHANGE_VERB =
  /\b(add|change|fix|update|reduce|increase|remove|delete|rename|refactor|implement|create|build|make|move|set|wire|migrate|replace|adjust|enable|disable|improve|write|edit|apply|correct|resolve|shrink|expand|hide|show|bump|revert|restore|install|upgrade|downgrade|rewrite|extract|split|merge)\b/i;

/**
 * Shapes that ask a QUESTION rather than demand a change. Checked FIRST, because
 * an action verb inside a question ("why did you change X?", "how do I add a
 * column?") is a question about a change, not a request for one.
 */
const QUESTION_SHAPE =
  /^\s*(what|why|how|where|when|which|who|is|are|was|were|does|do|did|can|could|should|would|will|explain|describe|summar|tell me|show me|list|compare|review|analyse|analyze)\b|\?\s*$/i;

/**
 * Does this text ask for something to be CHANGED (as opposed to found, explained
 * or summarized)?
 *
 * Used to decide whether an answer may be replayed from cache (it may not), and
 * whether "the run made no mutating call" is a finding or simply the shape of a
 * correct answer.
 */
export function asksForChange(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  // Only the opening of a long message decides its shape; a question that happens
  // to quote an action verb in paragraph nine does not make it a work order.
  const head = t.slice(0, 600);
  if (QUESTION_SHAPE.test(head)) return false;
  return CHANGE_VERB.test(head);
}

/**
 * An explicit statement that nothing was actually done — the honest half of the
 * failing answer, and the strongest single signal that it must not be cached.
 */
const NOTHING_DONE =
  /\b(nothing (has been|was|is) (changed|modified|applied|edited|written|saved)|no (changes?|edits?) (have been|were|was) (made|applied|written|saved)|(not|never) (yet )?(been )?(applied|written|saved|committed)|has not been (changed|applied|modified)|before (applying|making) the edit)\b/i;

/**
 * A first-person promise to do the work on some LATER turn. The tell is a future
 * commitment ("I'll apply", "I will make") or an explicit instruction to run the
 * agent again — both of which are unfulfillable the moment the answer is frozen
 * into a cache.
 */
const DEFERRED_PROMISE =
  /\b(re-?run me|run me again|ask me again|in a follow-?up|next run|on the next turn|say the word|let me know and I'?ll|I'?ll (then )?(apply|make|write|implement|create|edit|fix|update|do|proceed|carry)|I will (then )?(apply|make|write|implement|create|edit|fix|update|proceed))\b/i;

/**
 * Running out of room is the usual reason an answer ends up describing work
 * instead of doing it. Named separately so the reason survives into the caller.
 */
const BUDGET_EXHAUSTED =
  /\b(tool-?call budget|step budget|iteration (cap|limit|budget)|ran out of (tool calls|steps|budget)|hit (the|my) (tool|step|budget))\b/i;

/**
 * Does this ANSWER announce work it did not actually do?
 *
 * True for a reply that says nothing was changed, that defers the work to a later
 * run, or that reports exhausting its budget before acting. Such an answer is
 * honest and useful ONCE, in the conversation that produced it — and actively
 * harmful if replayed later as though it were a result.
 */
export function promisesUnfinishedWork(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  return NOTHING_DONE.test(t) || DEFERRED_PROMISE.test(t) || BUDGET_EXHAUSTED.test(t);
}

/**
 * Bare directives that carry no subject of their own. Anchored and whole-string:
 * "fix" is one, "fix the login redirect" is not — the latter says what to do.
 */
const CONTINUATION =
  /^\s*(?:ok(?:ay)?[,\s]*)?(?:please\s+)?(?:now\s+)?(?:just\s+)?(?:go\s+ahead|carry\s+on|keep\s+going|make\s+it\s+so|do\s+it|do\s+that|do\s+so|fix\s+it|fix\s+that|apply\s+it|apply\s+that|apply|fix|go|proceed|continue|yes|yep|yeah|y|sure|confirm(?:ed)?|approved?|ship\s+it|send\s+it|run\s+it|do\s+the\s+fix|make\s+the\s+change)\s*[.!]*\s*$/i;

/**
 * Longest a turn can be and still be a pure "you know what I mean" directive. A
 * short message that says anything specific is above this and is read normally.
 */
const MAX_CONTINUATION_CHARS = 40;

/**
 * Is this user turn a bare "carry on with what you just proposed" directive?
 *
 * The turn to watch for: the agent lays out a fix and stops, the user replies
 * "Fix", and the agent — reading that turn as a fresh, contextless request —
 * asks what needs fixing. The instruction is complete; its subject is simply the
 * previous turn.
 */
export function isContinuationDirective(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > MAX_CONTINUATION_CHARS) return false;
  return CONTINUATION.test(t);
}

/**
 * The directive to inject when a bare continuation lands on a turn that promised
 * unfinished work. Deterministic, so the handoff does not depend on the model
 * noticing the connection by itself — which is precisely what it failed to do.
 *
 * Phrased as a resolution of the ambiguity, not as extra pressure to act: the
 * agent is told WHAT the instruction refers to, and that asking is the one thing
 * that cannot help, because the answer is already in the transcript.
 */
export function continuationDirective(): string {
  return (
    'The user\'s last message is a bare directive ("fix", "do it", "go ahead") with no subject of its own. '
    + 'It refers to the proposal in YOUR immediately preceding message, which described work you had not yet carried out. '
    + 'Carry out that exact proposal now, using the tools, starting from the files and the change it already named — '
    + 'do NOT ask the user what to fix, and do NOT re-derive the analysis you have already done and can read above. '
    + 'If the earlier proposal named a specific file and edit, apply that edit. Report what you changed when it is done.'
  );
}
