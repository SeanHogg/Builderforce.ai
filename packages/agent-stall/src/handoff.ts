/**
 * The HANDOFF stall — the turn that ends by telling the USER to run the commands.
 *
 * `index.ts` catches four shapes of "the model would not act", and every one of them
 * is FIRST-PERSON: the promise ("I'll search the codebase"), the pseudo-call, the
 * missing-data claim, the blank turn. Its own `ANNOUNCE_SUBJECT` comment says the
 * quiet part out loud — "the very same verb aimed at the user (\"You can call the
 * API\", \"Check the gateway logs\") is a finished answer". For a chat assistant that
 * is true. For a CODING AGENT sitting in the user's workspace holding `run_command`,
 * `git_commit` and `git_push`, it is the opposite of true, and it is the most common
 * way a run ends having done half the job:
 *
 *     "I've applied the fix to boardRoutes.ts. Now run:
 *
 *     ```bash
 *     pnpm --filter builderforce-api type-check
 *     git commit -am 'fix types' && git push
 *     ```"
 *
 * Nothing there is a promise, a pseudo-call or a missing-data claim, so every existing
 * detector scores it a COMPLETE ANSWER and the run ends. The user asked for the errors
 * to be fixed; what they got was homework — with the agent's own verification step,
 * the one that would have caught the fix being wrong, assigned to them.
 *
 * Three gates keep this from firing on answers that are correct:
 *
 *  1. **The user asked for a CHANGE.** `asksForChange` — "how do I deploy this?" is
 *     answered with the commands to run, and that answer is finished and right.
 *  2. **This run could actually have run them.** {@link canExecuteCommands} over the
 *     tools the turn was offered. A web Brain with no shell telling you to run a build
 *     is reporting a limit, not shirking.
 *  3. **The command is within reach.** A handoff that needs a credential, a browser, a
 *     VS Code restart or a human approval is a genuine boundary — see
 *     {@link OUT_OF_REACH} — and is left alone.
 *
 * Zero-dependency and framework-free, like the rest of the package: one browser bundle
 * (VS Code webview / Next.js client), one Worker, one Node runtime.
 */

import { asksForChange } from './requestIntent.js';

/**
 * Tools that can run a command. Both spellings that exist in this codebase — the IDE
 * surface's `run_command` and the Claude-SDK runner's `Bash` — plus the git publish
 * tools, because "you should commit and push this" is the same handoff aimed at the
 * tools that exist precisely to do it.
 *
 * Matched by exact name rather than by prefix: a set is a DECLARATION of what "this
 * run could have done it itself" means, and a host that adds an executor adds it here.
 */
export const EXECUTION_TOOLS: ReadonlySet<string> = new Set([
  'run_command',
  'run_shell_command',
  'execute_command',
  'bash',
  'shell',
  'terminal',
  'git_commit',
  'git_push',
  'git_sync_latest',
  'open_pull_request',
  // The SERVER addressed-agent reply has no shell of its own — its shell lives in the
  // agent's runtime, and this tool is the door to it. Its own system prompt already
  // says "NEVER reply that you lack a git or file tool"; without this entry the gate
  // that enforces that sentence could never fire on the one surface it was written for.
  'builtin_chats_execute_as_agent',
]);

/** Could this run have run a command itself? Case-insensitive: the SDK spells it `Bash`. */
export function canExecuteCommands(toolNames: readonly string[] | undefined): boolean {
  return (toolNames ?? []).some((n) => EXECUTION_TOOLS.has(n.toLowerCase()));
}

/**
 * Command runners a handoff names. Presence of one of these near the instruction is
 * what separates "run `pnpm install`" from "run your own judgement on this" — prose
 * does not carry `pnpm`, `wrangler` or `npx` by accident.
 */
const RUNNER =
  '(?:npm|pnpm|yarn|npx|bun|deno|node|git|make|cargo|go|dotnet|mvn|gradle|python3?|pip3?|poetry|uv|ruby|rake|bundle|composer|php|docker(?:\\s+compose)?|kubectl|helm|terraform|wrangler|vercel|netlify|vite|webpack|tsc|tsgo|eslint|prettier|pytest|jest|vitest|playwright|cypress|bash|sh|zsh|pwsh|powershell|curl|wget|sed|awk|rsync|vsce)\\b';

/**
 * The other half of the same signal: the NAME of a project script, for handoffs that
 * do not quote the command. "Run the type-check", "kick off the build", "apply the
 * migration" are all work this agent had a tool for, and none of them say `pnpm`.
 *
 * Deliberately excludes anything that is normally a human's job to look at rather
 * than a machine's job to run (logs, dashboards, a PR review), so a closing sentence
 * pointing the user at something to READ is not read as work handed back.
 */
const SCRIPT_NOUN =
  '(?:build|tests?|test suite|type-?check(?:ing)?|typecheck|lint(?:er|ing)?|guards?|checks?|install|dev server|migrations?|deploy(?:ment)?|codegen|bundle|vsix|package|commit|push|pull request|pr\\b|branch|lockfile|extension host)';

/** A quoted command survives normalisation as this marker — see {@link normalise}. */
const CMD_MARK = '⦃cmd⦄';
/** A quoted identifier (`workflowStatus`) survives as this one, and never counts. */
const ID_MARK = '⦃id⦄';

/**
 * Work the agent genuinely CANNOT do, however many tools it holds. A handoff that
 * lands on one of these is a boundary being reported honestly, and re-prompting it
 * only produces a model that apologises and reports the same boundary again.
 */
const OUT_OF_REACH =
  /\b(credential|password|api ?key|secret|auth token|\.env\b|environment variable|2fa|mfa|sign ?in|log ?in|browser|incognito|restart vs ?code|reload the window|reinstall the extension|github ui|web ui|dashboard|billing|payment|admin console|approve|permission|by hand|manually)\b/i;

/**
 * How much of the reply's tail is scanned. Larger than `index.ts`'s 240: a handoff is
 * usually a "Next steps" SECTION — a heading, a fenced block and three bullets — and
 * cutting at 240 chars lands inside it rather than before it.
 */
const TAIL_CHARS = 900;

/** Characters searched around an instruction for the command it is about. */
const WINDOW_BEFORE = 80;
const WINDOW_AFTER = 220;

/**
 * Replace every fenced block and inline-code span with a marker, so that
 *
 *  - a shell line INSIDE a code block can never itself match an instruction shape
 *    (the agent quoting a CI log must not read as the agent assigning homework), and
 *  - the block still leaves behind the fact that a command was quoted there, for the
 *    window check below.
 *
 * Offsets shift, which is exactly why both halves run against this ONE normalised
 * string rather than against the original.
 */
function normalise(text: string): string {
  const mark = (body: string): string =>
    new RegExp(RUNNER, 'i').test(body) ? ` ${CMD_MARK} ` : ` ${ID_MARK} `;
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, (m) => mark(m))
    .replace(/`[^`\n]+`/g, (m) => mark(m));
}

const HANDOFF_VERB =
  '(?:re-?run|run|execute|apply|install|re-?install|rebuild|build|compile|commit|push|deploy|publish|restart|relaunch|launch|start|test|verify|lint|type-?check|typecheck|migrate|regenerate|package|bump|trigger|kick off)';

/**
 * The instruction aimed at the USER. Five shapes, all observed closing a coding turn.
 *
 * The last one — a bare line-leading imperative — is the broad one, and it is safe
 * only because {@link normalise} has already removed code blocks: a "Run …" that
 * survives to here is prose in a steps list, not a line of a script being quoted.
 */
const HANDS_OFF = new RegExp(
  [
    // "you can run", "you'll need to run", "you should now commit", "you must rebuild"
    `\\byou(?:'ll|'d|'ve| will| would| should| must| may| might| can| could| still| then| now)?(?:\\s+(?:then|now|also|just|still|next|first|finally|want to|need to|have to|be able to))*\\s+${HANDOFF_VERB}\\b`,
    // "please run the guards"
    `\\bplease\\s+(?:now\\s+|then\\s+)?${HANDOFF_VERB}\\b`,
    // "once you've run the build", "after you push"
    `\\b(?:once|after|when|before)\\s+you(?:'ve| have| had)?\\s+${HANDOFF_VERB}\\b`,
    // "run the following", "apply these changes", "execute this command"
    `\\b${HANDOFF_VERB}\\s+(?:the\\s+following|these|this)\\b`,
    // "to verify, run …" / "to apply the fix you need to run …"
    `\\bto\\s+(?:apply|verify|confirm|finish|complete|deploy|ship|land|pick up|see)\\b[^.\\n]{0,60}?,?\\s*(?:you\\s+(?:can|should|must|will|need to|have to)\\s+)?${HANDOFF_VERB}\\b`,
    // A steps list: "1. Run the type-check", "- Commit the change", "Then push to main"
    `(?:^|\\n)[ \\t]*(?:\\d+[.)]|[-*+]|#{1,6}|>)?[ \\t]*(?:then|now|next|finally|first)?[,:]?[ \\t]*${HANDOFF_VERB}\\b`,
    // The same imperative mid-paragraph: "I applied the fix. Now run the type-check."
    // The adverb is REQUIRED here, unlike the line-leading form above — without it a
    // plain sentence that happens to open with one of these words ("Build output is
    // clean now.") would read as an instruction.
    `[.!?]\\s+(?:then|now|next|finally|first)[,:]?\\s+${HANDOFF_VERB}\\b`,
  ].join('|'),
  'gi',
);

/** Is a command — quoted, named, or a known runner — within reach of this match? */
const COMMAND_NEARBY = new RegExp(`${CMD_MARK}|${RUNNER}|\\b${SCRIPT_NOUN}`, 'i');

/**
 * Does this reply hand the user commands to run instead of running them?
 *
 * Pure over the text alone — the capability and intent gates live in
 * {@link delegatesExecutableWork}, so this predicate stays usable on its own (the
 * run diagnostics report it without needing the tool catalog).
 */
export function handsWorkToUser(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  const scanned = normalise(t.slice(-TAIL_CHARS));
  HANDS_OFF.lastIndex = 0;
  for (let m = HANDS_OFF.exec(scanned); m; m = HANDS_OFF.exec(scanned)) {
    const window = scanned.slice(
      Math.max(0, m.index - WINDOW_BEFORE),
      m.index + m[0].length + WINDOW_AFTER,
    );
    if (!COMMAND_NEARBY.test(window)) continue;
    if (OUT_OF_REACH.test(window)) continue;
    HANDS_OFF.lastIndex = 0;
    return true;
  }
  return false;
}

/** What a loop knows about the turn's SURROUNDINGS, for the gates above. */
export interface HandoffContext {
  /** Names of the tools this turn was offered. */
  availableToolNames?: readonly string[];
  /** The user's own request for this run — NOT a nudge the loop injected. */
  requestText?: string | null;
}

/**
 * The full gate: an answer that hands back work this run was asked to do and had the
 * tools to do. All three conditions, so a caller cannot enforce two of them.
 */
export function delegatesExecutableWork(text: string, ctx: HandoffContext): boolean {
  if (!canExecuteCommands(ctx.availableToolNames)) return false;
  if (!asksForChange(ctx.requestText)) return false;
  return handsWorkToUser(text);
}

/**
 * The re-prompt for this shape. Deliberately NOT the wording in `stallRecoveryNudge`:
 * a model told "your last turn made zero tool calls, you said you would call a tool
 * and did not" when it in fact wrote a clear, complete set of instructions reads that
 * as wrong, and defends itself instead of acting. This one concedes the instructions
 * are right and says who is supposed to carry them out.
 */
export function handoffRecoveryNudge(lastChance: boolean): string {
  return (
    'Your last turn ended by telling the USER to run commands. You are the one holding the'
    + ' tools — `run_command` for shell steps, the git tools to commit and push — so those'
    + ' steps are yours, not theirs. Carry them out NOW in this turn: run the commands you'
    + ' just listed, read their output, and fix anything that fails before you answer.'
    + ' Verification you hand to the user is verification nobody does.'
    + ' Only leave a step to the user when you genuinely cannot do it here — it needs a'
    + ' credential, a browser, or a decision that is theirs — and then say which step and why.'
    + (lastChance
      ? ' This is your last chance to act: your answer after this turn is shown to the user'
        + ' as-is, so either run the commands now or state plainly, at the top of your reply,'
        + ' that the change is UNVERIFIED and exactly which steps were never run.'
      : '')
  );
}
