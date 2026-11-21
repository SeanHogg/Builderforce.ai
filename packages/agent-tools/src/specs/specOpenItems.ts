/**
 * A spec's OPEN ITEMS, as data — the rows a "ticket every open item" request is about.
 *
 * A spec (a PRD, `docs/specs/*.md`, a roadmap) says what is left to build in one of three
 * shapes, and this reads all three in document order:
 *
 *   (a) the ROADMAP gap register ({@link parseGapRegister}) — every gap is open work;
 *   (b) a STATUS TABLE: a markdown table whose header names an item column (`ID`, `Item`,
 *       `Feature`, `Task` …) and a `Status` / `State` column, with values such as
 *       Complete / Done / Incomplete / Open / Partial / In progress / Blocked or ✅ / ❌;
 *   (c) a CHECKLIST: `- [ ] …` (open) and `- [x] …` (done).
 *
 * Why: chat #157440 asked to restructure measure.md into a status section and "create
 * associated tickets" for every incomplete row. Nothing compared the spec's open rows
 * against the chat's tickets, so seven rows ended the run with none. The coverage join is
 * `ticketCoverage.ts`; this is the parse it reads.
 *
 * An item's id is the token the spec gives it (`P25-09`, `OUT-02`, `B4`, `§6.6`) when there
 * is one — the id column of a table, else a LEADING token of the text — so a ticket that
 * names it can be matched; otherwise a stable slug of its title. In a checklist or a gap
 * bullet a short leading token (`B4`, `S3`) is an id only when a separator follows it
 * (`B4: …`, `B4 — …`, `B4) …`) — `S3 bucket lifecycle policy` names no item.
 *
 * The SAME token listed twice (a summary table and a detail table both carry `P25-09`) is
 * ONE item: the most-open status wins (blocked > incomplete > unknown > complete), the more
 * descriptive (longer) title, the first line and section, and any stated blocker. A slug id
 * (no token) that repeats gets `-2`, `-3`, … in document order; a slug is never matched by name.
 *
 * Nested sub-items (`  - [ ] …` indented under a gap register bullet) belong to their gap and
 * are not items of their own.
 *
 * Pure: strings in, data out. No I/O.
 */

import { parseGapRegister, specSlug } from './gapRegister.js';

export type SpecItemStatus = 'incomplete' | 'blocked' | 'complete' | 'unknown';

export interface SpecOpenItem {
  /** The spec's own token for the item (`P25-09`, `§6.6`), or a slug of its title. */
  id: string;
  title: string;
  status: SpecItemStatus;
  /** The nearest heading above the item (markup removed), or '' above every heading. */
  section: string;
  /** 1-based line of the item's row, bullet or gap. */
  line: number;
  /** Why a blocked (or blocker-tagged) item cannot proceed, as the spec states it. */
  blocker?: string;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+\s*)?$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const CHECKLIST = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const MAX_BLOCKER = 300;

/**
 * An item token: `P25-09` / `OUT-02` / `PRD-12.3` (letters, a hyphen, digits), `B4` / `C6.2`
 * (up to three capitals then digits), or a section mark `§6.6` / `§25a.3`.
 */
const ITEM_TOKEN = String.raw`(?:§\s?\d+[a-z]?(?:\.\d+[a-z]?)*|[A-Z][A-Z0-9]*-\d+[A-Za-z0-9]*(?:\.\d+)*|[A-Z]{1,3}\d+(?:\.\d+)*[a-z]?)`;
const WHOLE_TOKEN = new RegExp(`^${ITEM_TOKEN}$`);
const LEADING_TOKEN = new RegExp(`^(${ITEM_TOKEN})(?=$|[\\s:.,;)\\]*_\`—–]|-\\s)`);
/** The long token forms (`P25-09`, `OUT-02`, `§6.6`): unambiguous wherever they lead. */
const LONG_TOKEN = /^(?:§|[A-Z][A-Z0-9]*-\d)/;
/** A leading token followed by a SEPARATOR (`:`, `—`, ` - `, `)`, `. `), closing markup allowed between. */
const SEPARATED_TOKEN = new RegExp(`^${ITEM_TOKEN}[*_\`\\]]*(?=$|\\s*[:—–)]|\\s+-\\s|\\.(?:\\s|$))`);

/** Is `id` a spec token (`P25-09`, `§6.6`) rather than a derived slug? Only a token is matched by name. */
export function isSpecItemToken(id: string): boolean {
  return WHOLE_TOKEN.test(id.trim());
}

/** Bold/italic/strike markers and leading list/link punctuation removed; backticks kept. */
function plain(text: string): string {
  return text.replace(/\*\*|__|~~/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The token a text STARTS with (after markup), or null. `separated` (checklists and bullets):
 * a short token (`B4`, `S3`) counts only when a separator follows it; the long forms always do.
 */
function leadingToken(text: string, separated = false): string | null {
  const head = text.replace(/^[\s*_`~[(]+/, '');
  const m = head.match(LEADING_TOKEN);
  if (!m) return null;
  if (separated && !LONG_TOKEN.test(m[1]!) && !SEPARATED_TOKEN.test(head)) return null;
  return m[1]!.replace(/\s+/g, '');
}

/** "Not blocked" in its phrasings — removed before a text is searched for a blocked mention. */
const NEGATED_BLOCKED = /\b(?:no longer blocked|not blocked|unblocked)\b/gi;

/**
 * How a status cell STARTS, as data — the leading word or mark decides first, so
 * `Complete (was blocked on infra)` is complete and `Done — no open issues` is done.
 * Order matters: the negated-blocked phrasings precede `blocked`.
 */
const LEADING_STATUS: ReadonlyArray<readonly [RegExp, SpecItemStatus]> = [
  [/^(?:no longer blocked|not blocked|unblocked)\b/i, 'incomplete'],
  [/^(?:[🚫⛔]|blocked\b)/iu, 'blocked'],
  [/^(?:[❌✗✖⬜🔲🟡🟠⚠⏳🚧]|(?:incomplete|not (?:started|done|ported|complete|completed|implemented|shipped|yet)|partial(?:ly)?|in[ -]progress|wip|to ?do|open|remaining|pending|missing|planned|outstanding)\b)/iu, 'incomplete'],
  [/^(?:[✅✔☑🟢]|(?:complete|completed|done|shipped|resolved|closed|finished|verified)\b)/iu, 'complete'],
];

/** Does the text say the item IS blocked (a mark or the word, not "not blocked" / "unblocked")? */
function mentionsBlocked(text: string): boolean {
  const affirmed = text.replace(NEGATED_BLOCKED, ' ');
  return /[🚫⛔]/u.test(affirmed) || /\bblocked\b/i.test(affirmed);
}

/** The reason after a blocked mark or word (`Blocked — operator` → `operator`), or ''. */
function blockerAfter(text: string): string {
  const affirmed = text.replace(NEGATED_BLOCKED, ' ');
  const at = affirmed.search(/[🚫⛔]|\bblocked\b/iu);
  const rest = at < 0 ? affirmed : affirmed.slice(at);
  return rest.replace(/^(?:[🚫⛔]️?\s*)?(?:blocked\b)?\s*(?:[—–:-]|on\b|by\b)?\s*/iu, '').trim();
}

function blockedStatus(text: string): { status: SpecItemStatus; blocker?: string } {
  const rest = blockerAfter(text);
  return rest ? { status: 'blocked', blocker: rest.slice(0, MAX_BLOCKER) } : { status: 'blocked' };
}

/**
 * A status cell or mark, classified. The LEADING word or mark first ({@link LEADING_STATUS});
 * otherwise a blocked mention anywhere (negations removed), then the open words (so
 * "Incomplete" is not read as "complete"), then the done words.
 */
export function classifySpecStatus(raw: string): { status: SpecItemStatus; blocker?: string } {
  const text = plain(raw);
  const head = text.replace(/^[\s*_`~[(]+/, '');
  const leading = LEADING_STATUS.find(([pattern]) => pattern.test(head));
  if (leading) return leading[1] === 'blocked' ? blockedStatus(head) : { status: leading[1] };
  if (mentionsBlocked(text)) return blockedStatus(text);
  if (/[❌✗✖⬜🔲🟡🟠⚠⏳🚧]/u.test(text)) return { status: 'incomplete' };
  if (/\b(incomplete|not started|not done|not ported|to ?do|open|partial(ly)?|in[ -]progress|wip|pending|missing|planned|outstanding|remaining)\b/i.test(text)) return { status: 'incomplete' };
  if (/[✅✔☑🟢]/u.test(text) || /\b(complete|completed|done|shipped|resolved|closed|finished|verified)\b/i.test(text)) return { status: 'complete' };
  return { status: 'unknown' };
}

/** A `Blocker: …` / `Blocker (verified …): …` statement in a row, or null. */
function statedBlocker(text: string): string | null {
  const m = plain(text).match(/\bBlocker\b(?:\s*\([^)]*\))?\s*:\s*(.+?)\*?$/i);
  return m ? m[1]!.trim().slice(0, MAX_BLOCKER) : null;
}

/** A table row's cells: outer pipes removed, split on unescaped `|`. */
function cellsOf(row: string): string[] {
  const body = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return body.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

interface TableColumns {
  id: number;
  title: number;
  status: number;
}

/** The item, title and status columns of a header row, or null when it is not a status table. */
function statusTableColumns(header: readonly string[]): TableColumns | null {
  const names = header.map((h) => plain(h).replace(/`/g, '').toLowerCase());
  const status = names.findIndex((n) => /\b(status|state)\b/.test(n));
  if (status < 0) return null;
  const id = names.findIndex((n, i) => i !== status && /^(id|#|ref|key|no\.?|item id|row)$/.test(n));
  const title = names.findIndex((n, i) => i !== status && i !== id && /\b(feature|task|item|title|name|requirement|work|deliverable|gap|description|summary|capability)\b/.test(n));
  if (id < 0 && title < 0) return null;
  return { id, title, status };
}

interface RawItem extends Omit<SpecOpenItem, 'id'> {
  token: string | null;
}

/**
 * Every item the spec lists, in document order, with its status. Only items with a status a
 * reader can act on are open work (`incomplete`, `blocked`); `complete` and `unknown` rows are
 * returned too so a caller can report the whole picture.
 */
export function parseSpecOpenItems(markdown: string): SpecOpenItem[] {
  const lines = markdown.split(/\r?\n/);
  const raw: RawItem[] = [];

  // (a) The gap register: each gap is open work.
  const gapLines = new Set<number>();
  for (const gap of parseGapRegister(markdown)) {
    gapLines.add(gap.line);
    raw.push({
      token: leadingToken(gap.summary, true) ?? gap.id,
      title: gap.summary,
      status: 'incomplete',
      section: [gap.stage, gap.group].filter(Boolean).join(' › '),
      line: gap.line,
      ...(gap.blocker ? { blocker: gap.blocker } : {}),
    });
  }

  // (b) status tables and (c) checklists.
  let section = '';
  let inFence = false;
  // Inside a gap's bullet: its indented lines (sub-checklists included) belong to the gap.
  let inGap = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(HEADING);
    if (heading) {
      section = plain(heading[1]!).replace(/`/g, '');
      inGap = false;
      continue;
    }
    if (gapLines.has(i + 1)) {
      inGap = true;
      continue;
    }
    if (/^\S/.test(line)) inGap = false;
    if (TABLE_ROW.test(line) && TABLE_SEPARATOR.test(lines[i + 1] ?? '')) {
      const columns = statusTableColumns(cellsOf(line));
      let j = i + 2;
      for (; j < lines.length && TABLE_ROW.test(lines[j]!); j++) {
        if (!columns) continue;
        const cells = cellsOf(lines[j]!);
        if (cells.every((c) => c === '')) continue;
        const idCell = columns.id >= 0 ? plain(cells[columns.id] ?? '').replace(/`/g, '') : '';
        const titleCell = plain(cells[columns.title >= 0 ? columns.title : columns.id] ?? '');
        const title = titleCell || idCell;
        if (!title) continue;
        const { status, blocker } = classifySpecStatus(cells[columns.status] ?? '');
        const stated = cells.map(statedBlocker).find((b): b is string => b != null) ?? null;
        const token = columns.id >= 0
          ? (leadingToken(idCell) ?? (idCell && idCell.length <= 40 && !/\s/.test(idCell) ? idCell : null))
          : leadingToken(titleCell);
        const why = stated ?? blocker;
        raw.push({ token, title, status, section, line: j + 1, ...(why && status === 'blocked' ? { blocker: why } : {}) });
      }
      i = j - 1;
      continue;
    }
    const check = line.match(CHECKLIST);
    if (check && !inGap) {
      const text = plain(check[2]!);
      const stated = statedBlocker(text);
      const done = check[1]!.toLowerCase() === 'x';
      const blocked = !done && (stated != null || mentionsBlocked(text));
      raw.push({
        token: leadingToken(text, true),
        title: text,
        status: done ? 'complete' : blocked ? 'blocked' : 'incomplete',
        section,
        line: i + 1,
        ...(blocked && stated ? { blocker: stated } : {}),
      });
    }
  }

  raw.sort((a, b) => a.line - b.line);
  const out: SpecOpenItem[] = [];
  const byToken = new Map<string, SpecOpenItem>();
  const usedSlugs = new Map<string, number>();
  for (const { token, ...item } of raw) {
    if (token) {
      const first = byToken.get(token);
      if (first) mergeRepeat(first, item);
      else {
        const entry: SpecOpenItem = { id: token, ...item };
        byToken.set(token, entry);
        out.push(entry);
      }
      continue;
    }
    const base = specSlug(item.title, 'item');
    const n = (usedSlugs.get(base) ?? 0) + 1;
    usedSlugs.set(base, n);
    out.push({ id: n === 1 ? base : `${base}-${n}`, ...item });
  }
  return out;
}

/** How open a status is: a repeated token keeps the most-open of its listings. */
const OPENNESS: Readonly<Record<SpecItemStatus, number>> = { blocked: 3, incomplete: 2, unknown: 1, complete: 0 };

/** A later listing of the same token folded into the first: most-open status, longer title, any blocker; first line/section kept. */
function mergeRepeat(first: SpecOpenItem, repeat: Omit<SpecOpenItem, 'id'>): void {
  if (OPENNESS[repeat.status] > OPENNESS[first.status]) first.status = repeat.status;
  if (repeat.title.length > first.title.length) first.title = repeat.title;
  if (!first.blocker && repeat.blocker) first.blocker = repeat.blocker;
}

/** The items that still owe a ticket: incomplete and blocked. */
export function specItemsOwingTickets(items: readonly SpecOpenItem[]): SpecOpenItem[] {
  return items.filter((i) => i.status === 'incomplete' || i.status === 'blocked');
}
