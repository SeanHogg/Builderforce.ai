/**
 * The PERMISSION-MENU stall — the turn that ends by asking the user to authorise work
 * the user has already asked for.
 *
 *     ### Recommendations
 *     1. For the 35 unmerged tickets: someone needs to push these branches and open PRs
 *     ...
 *     Would you like me to:
 *     - List all 35 unmerged ticket branches?
 *     - Attempt to open PRs for any of them?
 *     - Cancel/close the stalled tickets?
 *
 * Measured on VS Code chat #115 (`direct/minimax/MiniMax-M1`, 2026-09-20): the agent
 * surveyed the board across five tool calls, produced a correct and genuinely useful
 * report, and then stopped on that menu. The user answered "complete the 35, and merge
 * to main" — which is what they had already asked for — and the run resumed and did it.
 * One user turn bought nothing except the agent's permission to continue.
 *
 * It is invisible to all five existing shapes, and not by accident:
 *
 *  - not EMPTY — it is a long, well-structured reply;
 *  - not ANNOUNCED — `ANNOUNCE_SUBJECT` is first-person-committal ("I'll…", "Let me…"),
 *    and "Would you like me to…" is the precise opposite: it declines to commit;
 *  - not MISSING-DATA — the data is all there, in a table;
 *  - not HANDED-OFF — `handoff.ts` needs a COMMAND within reach of the instruction
 *    (`RUNNER`/`SCRIPT_NOUN`), and an offer to "open PRs" or "cancel the tickets" names
 *    platform actions the agent performs with tools, never a shell line.
 *
 * So the loop scored it a complete answer and ended the run, which is correct for a
 * chat assistant and wrong for an agent that holds the tools to do what it just offered.
 * The IDE persona has forbidden this in prose since it shipped — AUTONOMY_DIRECTIVE's
 * "Never end a turn with 'would you like me to…' for work that was already requested" —
 * and nothing enforced it, which is the whole reason it kept happening.
 *
 * Three gates keep it off answers that are correct:
 *
 *  1. **The user asked for a CHANGE.** {@link asksForChange}, the same gate `handoff.ts`
 *     uses. After "review the ticket status" — a question — closing with "want me to open
 *     PRs for these?" is a courteous offer of NEW work, not a stall, and is left alone.
 *  2. **The offer is about ACTION.** A menu whose options are verbs the agent could carry
 *     out, not a request for information only the user holds ("which of these two
 *     behaviours did you intend?").
 *  3. **It is the SIGN-OFF.** Tail-scanned: a mid-answer aside is not where a run stops.
 *
 * The remedy is deliberately two-branched — see {@link permissionRecoveryNudge}. Where a
 * choice really is the user's, the fix is not "act anyway", it is `ask_user`, which puts
 * the options on screen as buttons instead of stranding them in prose the run has already
 * ended on. That tool exists on every surface this package runs in and the IDE persona
 * never named it, which is why the model reached for a prose menu instead.
 *
 * Zero-dependency and framework-free, like the rest of the package.
 */

import { asksForChange } from './requestIntent.js';

/**
 * How much of the reply's tail is scanned. Matches `handoff.ts` rather than
 * `index.ts`'s 240: like a "Next steps" block, an offer menu is a SECTION — a lead-in
 * line and three bullets — and 240 characters lands inside it rather than before it.
 */
const TAIL_CHARS = 900;

/**
 * Verbs that name work this agent DOES. The discriminator that separates an offer of
 * action from a request for information: "Would you like me to open the PRs?" is a
 * stall, "Would you like me to use the American spelling?" is a preference only the
 * user can settle and is none of this module's business.
 *
 * Broader than `handoff.ts`'s `HANDOFF_VERB` because a permission menu offers PLATFORM
 * work as readily as shell work — cancel a ticket, assign an agent, file a spec — and
 * none of those words appear there.
 */
const ACTION_VERB =
  '(?:run|execute|apply|implement|install|rebuild|build|compile|commit|push|merge|rebase|deploy|publish|release|ship|open|create|file|draft|write|add|update|patch|edit|change|modify|fix|resolve|refactor|rename|move|delete|remove|drop|close|cancel|archive|assign|dispatch|schedule|start|kick off|trigger|link|list|enumerate|show|generate|produce|proceed|continue|go ahead|do (?:it|that|this|them|so)|handle|take care of|work through|go through|tackle|clean up|tidy|sort out|migrate|convert|split|extract|bump|revert|restore|retry|re-?try|re-?run|verify|test|check|review|investigate|dig into|look into)';

/**
 * The offer itself. Every alternative is a request for the user's GO-AHEAD; none of
 * them is a first-person commitment, which is exactly why `announcesUntakenAction`
 * cannot see them.
 */
const OFFER = new RegExp(
  [
    // "Would you like me to open the PRs?" · "Do you want me to merge these?"
    // · "Would you like me to proceed?"
    `\\b(?:would|do)\\s+you\\s+(?:like|want|prefer)\\s+(?:me|us)\\s+to\\b`,
    // "Shall I open PRs?" · "Should I cancel the stalled tickets?" · "Can I proceed?"
    // · "May I go ahead?"
    `\\b(?:shall|should|can|may)\\s+i\\b[^.?\\n]{0,80}\\?`,
    // "Want me to push these?" — the subjectless form.
    `\\bwant\\s+(?:me|us)\\s+to\\b`,
    // "Let me know if you'd like me to…" · "Let me know which of these to do"
    // · "Tell me which you'd prefer" · "Just say the word and I'll merge them"
    `\\blet me know\\b[^.\\n]{0,80}\\b(?:if|whether|which|what)\\b`,
    `\\b(?:tell|let)\\s+me\\s+know\\s+(?:which|what|whether|if)\\b`,
    `\\bsay the word\\b`,
    // "I can open the PRs if you'd like." · "I could cancel them if you want."
    // · "I'm happy to merge these if that's what you want."
    `\\bi\\s+(?:can|could|am happy to|'?m happy to|would be happy to)\\b[^.\\n]{0,120}?\\bif\\s+(?:you|that|you'?d|you would)\\b`,
    // "Confirm and I'll proceed." · "Approve and I'll merge them."
    `\\b(?:confirm|approve|give me the go-?ahead|give the go-?ahead)\\b[^.\\n]{0,40}\\band\\s+i(?:'ll| will)\\b`,
    // "Which would you like me to do first?" · "Which of these should I start with?"
    `\\bwhich\\s+(?:one|of these|of those)?\\s*(?:would|do|should|shall)\\s+(?:you|i)\\b`,
    // "Your call." · "Up to you." · "Let me know how you'd like to proceed."
    `\\b(?:your call|up to you|it'?s your call|how (?:would|do) you (?:want|like) (?:me )?to proceed)\\b`,
  ].join('|'),
  'gi',
);

/**
 * Characters searched after an offer for the ACTION it is offering. Generous, because
 * the options usually sit BELOW the lead-in as a bulleted list — the measured reply put
 * its three options on the three lines after "Would you like me to:".
 */
const WINDOW_AFTER = 400;
/** …and a little before it, for "I can push these — would you like me to?". */
const WINDOW_BEFORE = 120;

/** Is work the agent could DO within reach of the offer? */
const ACTION_NEARBY = new RegExp(`\\b${ACTION_VERB}\\b`, 'i');

/**
 * Choices that are genuinely the USER'S and that no amount of inference settles: what
 * they MEANT, what they would PREFER, which of two readings of their own request is
 * right. An agent pausing on one of these is doing its job, and re-prompting it to act
 * produces a confident guess at something it was right to be unsure about.
 *
 * Note this does NOT exempt the menu from the nudge entirely — see
 * {@link permissionRecoveryNudge}, which routes exactly this case to `ask_user` so the
 * question survives as something the user can click rather than as the last line of a
 * finished run.
 */
const USERS_OWN_CHOICE =
  /\b(?:did you mean|do you mean|what did you (?:mean|intend)|which did you mean|prefer(?:ence|red)?\b|intended behaviou?r|by design|is that (?:right|correct|intended|what you)|am i (?:right|correct) (?:that|in)|credential|password|api ?key|secret|which account|whose|budget|deadline|priorit(?:y|ise|ize))\b/i;

/**
 * Does this reply end by asking permission to do work, rather than doing it?
 *
 * Pure over the text alone — the capability and intent gates live in
 * {@link asksPermissionForRequestedWork} — so the run diagnostics can report it
 * without holding the tool catalog, exactly as they do for `handsWorkToUser`.
 */
export function offersMenuInsteadOfActing(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  const scanned = t.slice(-TAIL_CHARS);
  OFFER.lastIndex = 0;
  for (let m = OFFER.exec(scanned); m; m = OFFER.exec(scanned)) {
    const window = scanned.slice(
      Math.max(0, m.index - WINDOW_BEFORE),
      m.index + m[0].length + WINDOW_AFTER,
    );
    if (!ACTION_NEARBY.test(window)) continue;
    OFFER.lastIndex = 0;
    return true;
  }
  return false;
}

/**
 * Is the pause about something only the USER can answer? Reported separately from the
 * detection so the nudge can say the right thing — "act" and "ask properly" are
 * different corrections, and giving the second one as the first is how a model that was
 * right to pause gets told off for it.
 */
export function pausesOnUsersOwnChoice(text: string): boolean {
  return USERS_OWN_CHOICE.test((text ?? '').slice(-TAIL_CHARS));
}

/** What a loop knows about the turn's surroundings, for the gate below. */
export interface PermissionMenuContext {
  /** Names of the tools this turn was offered. */
  availableToolNames?: readonly string[];
  /** The user's own request for this run — NOT a nudge the loop injected. */
  requestText?: string | null;
}

/** The conversational question tool, where a host injects it. */
export const ASK_USER_TOOL_NAME = 'ask_user';

/** Was `ask_user` on the table this turn? Decides which half of the nudge applies. */
export function askUserAdvertised(toolNames: readonly string[] | undefined): boolean {
  return (toolNames ?? []).some((n) => n.toLowerCase() === ASK_USER_TOOL_NAME);
}

/**
 * The full gate: a turn that ends by asking whether to carry out work the user already
 * asked for, on a run that had tools to carry it out with.
 *
 * Three conditions, so a caller cannot enforce two of them. The tool gate is deliberately
 * "it had ANY tools" rather than a capability set like `handoff.ts`'s `EXECUTION_TOOLS`:
 * a permission menu offers platform work (`cancel the stalled tickets`, `open PRs`) as
 * often as shell work, and `stallShape` has already established `availableToolCount > 0`.
 *
 * The third condition is the one that keeps this honest. A pause on something only the
 * USER can settle is a legitimate pause — and on a surface with no `ask_user`, prose is
 * the only channel that question HAS, so re-prompting it just makes the model apologise
 * and ask again. Where `ask_user` does exist the pause still counts, because there the
 * prose menu is a worse version of a question the run could have put on screen as
 * buttons without ending.
 */
export function asksPermissionForRequestedWork(text: string, ctx: PermissionMenuContext): boolean {
  if (!asksForChange(ctx.requestText)) return false;
  if (!offersMenuInsteadOfActing(text)) return false;
  if (pausesOnUsersOwnChoice(text) && !askUserAdvertised(ctx.availableToolNames)) return false;
  return true;
}

/**
 * The re-prompt for this shape.
 *
 * Two branches on purpose. A model told bluntly to "just act" when it had stopped on a
 * question only the user could answer will guess — and a confident guess at the user's
 * intent is a worse outcome than the pause was. So the correction says what to do in
 * BOTH cases and lets the model pick: carry out what was requested, or ask through the
 * tool that renders the options as buttons. What it may not do is end the run on a
 * question typed into prose, because the run ending is what makes that question cost a
 * whole round trip to answer.
 *
 * Wording is not shared with `stallRecoveryNudge`: a model told "your last turn made zero
 * tool calls, you said you would call a tool and did not" when it in fact wrote a clear,
 * complete report and a polite offer reads that as simply wrong and argues with it
 * instead of acting — the same failure `handoffRecoveryNudge` exists to avoid.
 */
export function permissionRecoveryNudge(lastChance: boolean, askUserAvailable = false): string {
  const askBranch = askUserAvailable
    ? ` If some part of it genuinely IS the user's decision — two defensible options with no`
      + ` sensible default, something only they know — call \`${ASK_USER_TOOL_NAME}\` with the`
      + ` options as labelled choices instead of listing them in prose. That puts them on screen`
      + ` as buttons; a question in prose ends the run and costs a full round trip to answer.`
      + ` Do the parts that are NOT in question first, then ask about the rest.`
    : ` If some part of it genuinely IS the user's decision, say which single question you need`
      + ` answered, state which option you recommend and why, and carry out everything that does`
      + ` NOT depend on the answer before you stop.`;
  return (
    'Your last turn ended by asking the user whether to do work they had ALREADY asked for.'
    + ' You hold the tools to do it, so the answer is yes and it is yours to carry out:'
    + ' pick the sensible default for anything you offered as an option, and DO IT NOW in this'
    + ' turn. Report what you did afterwards — do not re-state the offer.'
    + askBranch
    + (lastChance
      ? ' This is your last chance to act: your answer after this turn is shown to the user as-is,'
        + ' so either start the work now or state plainly, at the top of your reply, exactly what'
        + ' you did NOT do and the one decision you are blocked on.'
      : '')
  );
}
