/**
 * The loop-breaker for re-reading.
 *
 * The run loop already suppresses an EXACT repeat of a read — same tool, same
 * arguments — and returns a stub telling the model to reuse the earlier result.
 * That catches a model that asks the identical question twice. It does not catch
 * the failure that actually burns runs:
 *
 *     read_file(LandingCanvasHero.module.css, offset 1)
 *     read_file(LandingCanvasHero.module.css, offset 140)
 *     read_file(LandingCanvasHero.module.css, offset 141)   ← one line later
 *     read_file(LandingCanvasHero.module.css, offset 208)
 *     read_file(LandingCanvasHero.module.css, offset 240)
 *     read_file(LandingCanvasHero.module.css, offset 340)
 *     read_file(LandingCanvasHero.module.css, offset 440)
 *
 * Seven DIFFERENT calls, so the exact-repeat guard stays silent for all of them,
 * while the model shuffles a window up and down one 566-line file until the tool
 * budget is gone and the user's actual request — a one-line CSS change — is never
 * made. Every existing signal scores that run clean.
 *
 * The fix is not to block the read: a legitimate second pass over a large file is
 * normal, and refusing it would break real work. The fix is to make the model AWARE
 * that it is circling, at the only moment it can act on that — inside the tool
 * result it is about to read — and to tell it exactly what it has already been
 * shown, so "I'll just look again" stops being the cheapest next move.
 *
 * Pure and self-contained: a small tally with one method to record a visit and one
 * to describe it. No clock, no I/O.
 */

import { activityTarget } from './runActivity';
import { isUnscopedMutationTool } from './localWorkspaceTools';

/**
 * Visits to one target before the model is told it is circling. Two reads of a
 * long file is ordinary (read the top, jump to the section); the THIRD is the
 * point where a pass stops being navigation and starts being a loop.
 */
export const REVISIT_NUDGE_AT = 3;

/**
 * Visits after which the advisory escalates from a reminder to an instruction.
 * By the fifth read of one file the gentle version has demonstrably not worked.
 */
export const REVISIT_HARD_AT = 5;

export interface ReadVisit {
  /** How many times this target has now been read, including this call. */
  count: number;
  /** The distinct argument sets already used against it, oldest first, capped. */
  priorArgs: string[];
}

/** Distinct argument sets remembered per target — enough to quote back, not a log. */
const MAX_REMEMBERED_ARGS = 8;

/**
 * Per-run tally of which targets have been read and how. One instance per run;
 * the run loop owns it and drops it when the run ends.
 */
export class ReadCoverage {
  private readonly visits = new Map<string, ReadVisit>();

  /**
   * Record a read and return the resulting visit, or null when the call names no
   * target (nothing to be circling around). `args` is the parsed argument object.
   */
  record(tool: string, args: unknown): ReadVisit | null {
    const target = activityTarget(args);
    if (!target) return null;
    const key = `${tool}:${target}`;
    const existing = this.visits.get(key);
    let argText: string;
    try {
      argText = JSON.stringify(args ?? {});
    } catch {
      argText = String(args ?? '');
    }
    if (!existing) {
      const fresh: ReadVisit = { count: 1, priorArgs: [argText] };
      this.visits.set(key, fresh);
      return fresh;
    }
    existing.count += 1;
    if (!existing.priorArgs.includes(argText) && existing.priorArgs.length < MAX_REMEMBERED_ARGS) {
      existing.priorArgs.push(argText);
    }
    return existing;
  }

  /**
   * A mutation makes a re-read of WHAT IT CHANGED legitimate — that read returns
   * genuinely new information, and nagging about it would punish exactly the right
   * behaviour. So the tally for that target is dropped.
   *
   * It says nothing about any OTHER target, and treating it as if it did is what made
   * this guard almost inert. Clearing the whole map on every non-read call meant a
   * single `edit_file`, ticket write, git status or failed dispatch wiped the history
   * of every file in the run — and in a run that interleaves reads with platform
   * writes, the counter never reached three. Measured on the run this was built for:
   * one CSS file read 14 times and its component 13, across 78 calls, with the
   * advisory firing on neither.
   *
   * A tool that can touch arbitrary files (`run_command` — a codemod, a formatter, a
   * checkout) is the one honest exception: the answer to "what did that change?" is
   * unknown, so everything is invalidated.
   */
  invalidate(tool: string, args: unknown): void {
    if (isUnscopedMutationTool(tool)) {
      this.visits.clear();
      return;
    }
    const target = activityTarget(args);
    // A mutation with no resolvable target changed nothing ON DISK that this tally
    // describes (a ticket write, a dispatch, a sign-off), so it invalidates nothing.
    if (!target) return;
    // Keyed `${tool}:${target}`, and the edit invalidates the target across every
    // tool that reads it — `read_file` and `search_code` on one path are the same
    // stale picture.
    for (const key of [...this.visits.keys()]) {
      if (key.slice(key.indexOf(':') + 1) === target) this.visits.delete(key);
    }
  }

  /** Targets read more than once, most-revisited first — for the run's own reporting. */
  repeated(): { target: string; count: number }[] {
    return [...this.visits.entries()]
      .filter(([, v]) => v.count > 1)
      .map(([target, v]) => ({ target, count: v.count }))
      .sort((a, b) => b.count - a.count);
  }
}

/**
 * The advisory to attach to a read result once a target has been visited enough
 * times to look like circling. Null below the threshold — the overwhelming majority
 * of reads carry nothing extra.
 *
 * Written as a diagnosis plus a next move, not a scolding: a model told only "you
 * are repeating yourself" tends to repeat itself apologetically. It is told what it
 * has already been given, why looking again will not help, and which of the two
 * things it should do instead — read the file WHOLE, or act on what it has.
 */
export function revisitAdvisory(tool: string, target: string, visit: ReadVisit): string | null {
  if (visit.count < REVISIT_NUDGE_AT) return null;

  const shape = visit.priorArgs.length > 1
    ? ` The argument sets you have already used on it: ${visit.priorArgs.map((a) => `\`${a}\``).join(', ')}.`
    : '';

  if (visit.count >= REVISIT_HARD_AT) {
    return `STOP RE-READING. This is call ${visit.count} of \`${tool}\` against ${target} in this run, and the previous ${visit.count - 1} results are all still above you in this conversation.${shape} Re-reading it again will return content you already have and will not move the task forward — this pattern is how a run exhausts its tool budget without producing a single change. Do ONE of these now: (a) if you still need more of the file, request it WHOLE in a single call instead of another window; (b) otherwise stop reading and make the edit, or state plainly what is blocking you. Do not issue another partial read of this target.`;
  }

  return `You have now read ${target} ${visit.count} times in this run with \`${tool}\`, and every earlier result is still above you in this conversation.${shape} If you are looking for something you have not found, another window over the same file is unlikely to surface it — read the file whole in one call, or search for the specific symbol. If you already have what you need, act on it rather than re-reading.`;
}

/**
 * Attach an advisory to a tool result without disturbing its shape. Object results
 * gain a `note` field (the same channel the run loop's dedupe stub already uses, so
 * the model meets one convention rather than two); anything else is wrapped so the
 * original value survives intact under `result`.
 */
export function withAdvisory(result: unknown, advisory: string): unknown {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const existing = (result as { note?: unknown }).note;
    const note = typeof existing === 'string' && existing ? `${existing}\n\n${advisory}` : advisory;
    return { ...(result as Record<string, unknown>), note };
  }
  return { result, note: advisory };
}
