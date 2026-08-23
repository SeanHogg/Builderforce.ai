/**
 * THE reading of a meeting's minutes.
 *
 * `summarizeMeeting` (api/src/application/meetings/meetingIntelligence.ts) asks the model
 * for one shape and stores the result as Markdown on `meetings.summary`:
 *
 *     a one-paragraph **Summary**
 *     a **Decisions** bullet list      (omitted entirely when there were none)
 *     an **Action items** checklist    ("- [ ] Owner — task", omitted when none)
 *
 * Every surface that wants an action item out of that text has to agree on how to read
 * it, and a second reading is a second set of follow-ups from one meeting — the board
 * would place cards the notes panel never showed. So the parse lives here, once, and is
 * shared by the minutes panel and the board act that turns the checklist into cards.
 *
 * It is deliberately TOLERANT and never throws. The input is model-authored prose, so
 * "the section header came back as `### Action Items`" and "the em dash is a hyphen" are
 * normal, not corrupt; anything it cannot recognise is simply not an action item, and the
 * full Markdown is still rendered verbatim next to it. Nothing here is authoritative
 * enough to hide the original from anyone.
 */

/** One line of the minutes' checklist. `owner` is null when the line named no one. */
export interface MinutesActionItem {
  /** Who the line put it on, verbatim — matched against the board's own names by the
   *  caller, never resolved here (this module knows nothing about members). */
  owner: string | null;
  /** What is to be done. Never empty — a line that parsed to nothing is dropped. */
  task: string;
  /** Already ticked in the minutes (`- [x]`). Kept so a re-run does not re-place work
   *  the team has already closed out. */
  done: boolean;
}

export interface MeetingMinutes {
  /** The prose above the first recognised section — the recap. */
  summary: string;
  decisions: string[];
  actionItems: MinutesActionItem[];
}

/** A heading for one of the sections we read, at any level and with or without bold. */
const SECTION = /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*|__)?\s*(summary|decisions?|action\s*items?|actions)\s*(?:\*\*|__)?\s*:?\s*$/i;
/** A bullet: `-`, `*`, `+` or `1.`, with an optional `[ ]` / `[x]` checkbox. */
const BULLET = /^\s{0,6}(?:[-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s*)?(.*)$/;
/**
 * `Owner — task`. Accepts the em dash the prompt asks for, the en dash and the ` - `
 * a model reaches for anyway, and a colon. Bounded on the left so a task that merely
 * CONTAINS a dash ("Rework the sign-up — see thread") does not turn its first three
 * words into an owner: an owner is a short leading run with no sentence punctuation.
 */
const OWNED = /^([^—–:.!?]{1,40}?)\s*(?:—|–|:|\s-\s)\s*(.+)$/;

/** Which section a heading opened, or null when the line is not one we track. */
function sectionOf(line: string): 'summary' | 'decisions' | 'actions' | null {
  const match = SECTION.exec(line);
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (name.startsWith('summary')) return 'summary';
  if (name.startsWith('decision')) return 'decisions';
  return 'actions';
}

/** Strip the inline emphasis the model wraps names in, so `**Ana**` is `Ana`. */
function plain(text: string): string {
  return text.replace(/\*\*|__|`/g, '').trim();
}

/**
 * Read minutes Markdown into its three parts.
 *
 * A null/blank summary yields empty everything rather than a thrown error, because the
 * common case for "no minutes" is a meeting nobody has summarized yet, and every caller
 * would otherwise wrap this in the same try.
 */
export function parseMeetingMinutes(markdown: string | null | undefined): MeetingMinutes {
  const source = typeof markdown === 'string' ? markdown : '';
  if (!source.trim()) return { summary: '', decisions: [], actionItems: [] };

  const summary: string[] = [];
  const decisions: string[] = [];
  const actionItems: MinutesActionItem[] = [];
  // Prose before any heading is the recap — the prompt asks for the summary first and
  // models routinely lead with it and label only the sections that follow.
  let current: 'summary' | 'decisions' | 'actions' = 'summary';

  for (const raw of source.split(/\r?\n/)) {
    const heading = sectionOf(raw);
    if (heading) { current = heading; continue; }

    const bullet = BULLET.exec(raw);
    if (current === 'summary') {
      // A bullet inside the recap is still recap text; keep the line as authored.
      if (raw.trim()) summary.push(raw.trimEnd());
      continue;
    }
    if (!bullet) continue;

    const [, checkbox, rest] = bullet;
    const text = plain(rest);
    if (!text) continue;

    if (current === 'decisions') { decisions.push(text); continue; }

    const owned = OWNED.exec(text);
    actionItems.push({
      owner: owned ? plain(owned[1]) || null : null,
      task: owned ? plain(owned[2]) : text,
      done: checkbox?.toLowerCase() === 'x',
    });
  }

  return { summary: summary.join('\n').trim(), decisions, actionItems };
}

/**
 * The title a follow-up card gets. Shared so the card the board places and the line the
 * panel lists are recognisably the same item — an owner prefix on one and not the other
 * is how "did this already get pulled across?" becomes unanswerable.
 */
export function actionItemTitle(item: MinutesActionItem): string {
  return item.owner ? `${item.owner} — ${item.task}` : item.task;
}
