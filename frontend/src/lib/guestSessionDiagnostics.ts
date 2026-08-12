/**
 * guestSessionDiagnostics — one adoption session as ONE pasteable handover.
 *
 * The Adoption sessions table answers "who showed up and what did they ask for?"
 * at a glance, which means every cell in it is a SUMMARY: the intent is clamped to
 * three lines, the engagement is two numbers, and the prompt history is not on the
 * page at all. That is the right table and the wrong artefact to hand to anyone —
 * a growth question ("did this lead ever come back?"), a support question ("what
 * did they actually type before they gave up?") and a privacy question ("what do
 * we hold on this visitor id?") all need the parts the row deliberately hides.
 *
 * A screenshot of the row loses all three. So this serialises the whole lead,
 * ANSWER FIRST — where they got to in the funnel, before any raw prompt — and
 * treats the prompt history as the appendix it is: windowed, and always explicit
 * about what was dropped.
 *
 * The prompts are fetched separately from the row (`GET /api/admin/guest-sessions/
 * :visitorId`), so `prompts: null` is a real and different state from "this
 * visitor typed nothing". Both are STATED rather than rendered as an empty list,
 * because an unavailable history that reads as "no prompts" turns the one fact the
 * report exists to carry into a confident zero.
 *
 * PURE — no clock, no fetch, no DOM, no i18n (see {@link ./diagnosticsReport} for
 * why the body is deliberately locale-independent English while the buttons around
 * it are not). {@link ./diagnosticsCapture} owns the impure capture.
 */
import type { AdminGuestPrompt, AdminGuestSession } from './adminApi';
import {
  capText,
  environmentLines,
  jsonAppendix,
  line,
  windowRows,
  type DiagnosticsContext,
} from './diagnosticsReport';
import { formatAge } from './duration';

/**
 * Per-prompt cap, deliberately well above the shared {@link MAX_DETAIL_CHARS}
 * default: elsewhere the free text is context AROUND a finding, but here the
 * prompt IS the finding. Measured production prompts (the LMS course briefs) run
 * past 900 characters and stay meaningful to the end, so a 300-char cap would
 * truncate exactly the part a growth or support reader opened the report for.
 */
export const MAX_PROMPT_CHARS = 1_200;

// A visitor's history is unbounded — one measured session carried 84 prompts.
// Head + tail because both ends are load-bearing: the first prompt is the intent
// they arrived with, the last is where they gave up.
export const PROMPT_WINDOW_HEAD = 6;
export const PROMPT_WINDOW_TAIL = 24;

/** Everything the report needs, already gathered by the surface (pure in). */
export interface GuestSessionDiagnosticsInput {
  session: AdminGuestSession;
  /** The visitor's prompts, newest first. `null` when the fetch failed — STATED,
   *  never rendered as an empty history. */
  prompts: AdminGuestPrompt[] | null;
  /** The error the prompt fetch failed with, when it did. */
  promptsError?: string | null;
}

/**
 * Where this visitor got to, in one word.
 *
 * Paid outranks registered outranks guest — the same precedence the table's
 * conversion badge uses, kept here so the report and the badge can never disagree
 * about a visitor who is both converted and paying.
 */
export function funnelOutcome(session: AdminGuestSession): 'paid' | 'registered' | 'guest' {
  if (session.isPaid) return 'paid';
  if (session.converted) return 'registered';
  return 'guest';
}

/**
 * How long this visitor was in contact, first touch to last.
 *
 * Derived from the two stamps rather than from the clock, so the builder stays
 * pure — and so the span means the same thing whenever the report is re-read.
 * Unparseable stamps degrade to null rather than to `NaN`, which would print as a
 * confident-looking nonsense duration.
 */
export function sessionSpanMs(session: AdminGuestSession): number | null {
  const first = Date.parse(session.firstSeenAt);
  const last = Date.parse(session.lastSeenAt);
  if (Number.isNaN(first) || Number.isNaN(last)) return null;
  return Math.max(0, last - first);
}

/** One prompt row: when, where, and what — in that order, so the list scans. */
function promptRow(prompt: AdminGuestPrompt, index: number): string {
  const mode = prompt.mode ? ` · mode=${prompt.mode}` : '';
  const ref = prompt.sessionRef ? ` · session=${prompt.sessionRef}` : '';
  return `${index + 1}. [${prompt.createdAt}] ${prompt.surface}${mode}${ref}\n   ${capText(prompt.prompt, MAX_PROMPT_CHARS)}`;
}

/** A pasteable, bounded handover for one anonymous lead. */
export function buildGuestSessionReport(
  input: GuestSessionDiagnosticsInput,
  context: DiagnosticsContext,
): string {
  const { session, prompts } = input;
  const span = sessionSpanMs(session);

  // Rendered before windowing so the numbering reflects each prompt's true
  // position in the full history, not its position in the surviving slice.
  const promptRows = (prompts ?? []).map(promptRow);

  const body = [
    `# Adoption session — ${session.visitorId}`,
    '',
    ...environmentLines(context, [
      ['visitorId', session.visitorId],
      ['sessionId', session.id],
    ]),
    '',
    // ANSWER FIRST: the funnel position is the question every reader of this
    // report arrives with, and it is one line above everything that explains it.
    '-- Standing --',
    line('outcome', funnelOutcome(session)),
    line('converted', session.converted),
    line('convertedEmail', session.convertedEmail),
    line('convertedUserId', session.convertedUserId),
    line('convertedAt', session.convertedAt),
    line('paid', session.isPaid),
    '',
    '-- Acquisition --',
    line('landingPath', session.landingPath),
    line('referrer', session.referrer),
    line('firstSeenAt', session.firstSeenAt),
    line('lastSeenAt', session.lastSeenAt),
    // Day-scale on purpose: the measured leads span weeks between first and last
    // touch, and "912h 00m" is not a number anyone reasons about.
    line('activeSpan', span === null ? null : formatAge(span)),
    '',
    '-- Engagement --',
    line('prompts', session.promptCount),
    line('brainMessages', session.guestChatCount),
    line('brainTokens', session.guestChatTokens),
    line('toolRuns', session.toolRuns),
    line('lastSurface', session.lastSurface),
    line('lastPromptAt', session.lastPromptAt),
    '',
    '-- Intent --',
    line('firstPrompt', session.firstPrompt === null ? null : capText(session.firstPrompt, MAX_PROMPT_CHARS)),
    line('lastPrompt', session.lastPrompt === null ? null : capText(session.lastPrompt, MAX_PROMPT_CHARS)),
    '',
    // The row count comes from the fetched history when it is available and from
    // the session's own counter when it is not, so the heading never claims to
    // have listed prompts it could not load.
    `-- Prompt history (${prompts === null ? `${session.promptCount} recorded, not loaded` : prompts.length}) --`,
    ...(prompts === null
      ? [`(the prompt history could not be loaded${input.promptsError ? `: ${capText(input.promptsError)}` : ''})`]
      : promptRows.length === 0
        ? ['(no prompts recorded for this visitor)']
        : windowRows(promptRows, {
            head: PROMPT_WINDOW_HEAD,
            tail: PROMPT_WINDOW_TAIL,
            note: (elided) => ['', `… ${elided} prompts elided …`, ''],
          })),
  ];

  const text = body.join('\n');
  return [
    text,
    '',
    // Re-parseable payload; drops the prompt history first when the budget is
    // tight, since it is the one block already rendered (and windowed) above.
    ...jsonAppendix(text.length, { session, prompts }, {
      compact: () => ({ session, promptCount: prompts?.length ?? null }),
      note: '(prompt history omitted to stay within the paste budget — it is rendered above)',
    }),
  ].join('\n');
}
