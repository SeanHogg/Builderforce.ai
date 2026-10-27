/**
 * stopIntent — does a message typed during a run mean "stop the run"?
 *
 * Ported verbatim from `packages/run-guards/src/stopIntent.ts` (WS2c, PRD 35 §4 row 2c).
 * The person typing "STOP executing" mid-run meant the Stop button; before this the text
 * only joined the queue behind the very run it was trying to end (PRD 35 E10). The rule
 * is deliberately narrow — the WHOLE message must be a stop command — so an instruction
 * that merely contains the word never ends a run:
 *   matches   "stop", "STOP executing", "stop now", "stop the run", "halt", "abort",
 *             "cancel the run", "/stop", "esc";
 *   ignores   "don't stop", "stop the server", "stop using X", "how do I stop…".
 * Pure: no I/O.
 */

/** The one normaliser both layers start from: surrounding space off, lower-cased. */
function normalizeStopText(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * The EXACT-WORD layer — the on-prem auto-reply's abort triggers: the whole message,
 * normalised, is one of these bare words. Wider than {@link stopIntent}'s verbs (`wait`,
 * `exit`, `interrupt` abort a channel reply) and narrower in shape (no tail, no
 * politeness, and `/stop` is the command parser's, not a trigger).
 */
export const ABORT_TRIGGERS: ReadonlySet<string> = new Set(["stop", "esc", "abort", "wait", "exit", "interrupt"]);

/** True when the whole message is one of {@link ABORT_TRIGGERS}. */
export function isAbortTrigger(text?: string | null): boolean {
  if (!text) return false;
  return ABORT_TRIGGERS.has(normalizeStopText(text));
}

/** Words that ARE the command. `cancel` needs an object (`cancel the run`); the rest stand alone. */
const BARE_VERBS = new Set(["stop", "halt", "abort", "esc", "/stop"]);
const OBJECT_VERBS = new Set(["cancel"]);
/** Politeness the message may open with. */
const LEADS = new Set(["please", "ok", "okay", "hey", "now"]);
/** What may follow the verb and still be only "stop the run". */
const TAIL = new Set([
  "now", "right", "immediately", "asap", "please", "it", "this", "that", "everything", "all",
  "the", "run", "task", "job", "work", "working", "executing", "execution", "running", "agent",
  "current", "stop", "halt", "abort", "here",
]);
/** A `cancel` tail must name the work itself. */
const CANCEL_OBJECTS = new Set(["run", "task", "job", "execution", "it", "this", "that", "everything", "all", "work"]);
const MAX_WORDS = 6;

export function stopIntent(text: string | undefined | null): boolean {
  if (!text) return false;
  const words = normalizeStopText(text)
    .replace(/[.!…]+$/u, "")
    .split(/[\s,]+/)
    .map((w) => w.replace(/^[!.]+|[!.]+$/g, ""))
    .filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return false;
  let i = 0;
  while (i < words.length - 1 && LEADS.has(words[i]!)) i++;
  const verb = words[i]!;
  const tail = words.slice(i + 1);
  if (!tail.every((w) => TAIL.has(w))) return false;
  if (BARE_VERBS.has(verb)) return true;
  return OBJECT_VERBS.has(verb) && tail.some((w) => CANCEL_OBJECTS.has(w));
}
