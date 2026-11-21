/**
 * "Does every open item of this spec have a ticket?" — the join of a spec's open items
 * ({@link parseSpecOpenItems}) with a chat's or project's tickets.
 *
 * Chat #157440 asked for a ticket per incomplete row of measure.md; seven rows ended the run
 * with none, and the board still LOOKED linked because the run's auto-captured
 * "Code change (N files) from Brain chat #N" ticket sat on the chat. That ticket records a
 * diff, not a spec item, so it never counts here ({@link isCodeChangeBackstopTitle}).
 *
 * ── HOW A TICKET COVERS AN ITEM ──────────────────────────────────────────────────
 *   (a) the item's id (`P25-09`, `§6.6`, a gap id) appears as a WHOLE token in the
 *       ticket's title or description; or
 *   (b) the ticket's title is the same work as the item's title under THE near-duplicate
 *       rule ({@link areNearDuplicateTokens}) every idempotent create dedups with.
 * A derived slug id is never matched by name — nobody writes one in a ticket.
 *
 * Complete (and unreadable-status) items need no ticket; incomplete and blocked ones do, and a
 * blocked item's ticket may itself be `blocked`. A cancelled/archived ticket covers nothing.
 *
 * Pure: no I/O.
 */

import { areNearDuplicateTokens, normalizeTitle, titleTokens } from './nearDuplicateTitle.js';
import { isSpecItemToken, specItemsOwingTickets, type SpecOpenItem } from './specOpenItems.js';

/** One ticket as the coverage join reads it. `id` is whatever the caller keys tickets by. */
export interface CoverageTicket<Id = string | number> {
  id: Id;
  title: string;
  description?: string | null;
  status: string;
  /** The caller already knows this is an auto-captured code-change ticket. */
  isBackstop?: boolean;
}

export interface SpecTicketCoverage<Id = string | number> {
  covered: Array<{ itemId: string; ticketIds: Id[] }>;
  missing: SpecOpenItem[];
}

/** Lanes a ticket that no longer stands for its work sits in. */
const DEAD_STATUSES: ReadonlySet<string> = new Set(['cancelled', 'canceled', 'archived', 'deleted', 'wont_do', "won't do", 'duplicate']);

/** The auto-captured code-change ticket's title: minted, or re-titled at ship (no source). */
const CODE_CHANGE_TITLE = /^code change \(\d+ files?\)(?: from .+)?$/i;

/**
 * THE title of the run's auto-captured code-change ticket (`runBackstops.ts` mints and
 * re-titles it) — `Code change (3 files) from Brain chat #7`, or `Code change (8 files)`
 * once re-titled from the shipped diff.
 */
export function codeChangeTicketTitle(fileCount: number, source?: string): string {
  const base = `Code change (${fileCount} file${fileCount === 1 ? '' : 's'})`;
  return source ? `${base} from ${source}` : base;
}

/** Is this the auto-captured code-change ticket ({@link codeChangeTicketTitle})? It records a diff, never a spec item. */
export function isCodeChangeBackstopTitle(title: string): boolean {
  return CODE_CHANGE_TITLE.test(title.trim());
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Is the id matched by name — a spec token, or a gap register id (`make/foo`)? */
const matchableId = (id: string): boolean => isSpecItemToken(id) || /^[a-z]+\/[a-z0-9-]+$/.test(id);

/** The id as a whole token: `P25-09` must not match inside `P25-091`, `XP25-09` or `§6.61`. */
function idPattern(id: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9§/.-])${escapeRegExp(id)}(?![A-Za-z0-9]|[.-][A-Za-z0-9])`, 'i');
}

/** Which tickets cover which open item, and the open items no ticket covers. */
export function specTicketCoverage<Id = string | number>(
  openItems: readonly SpecOpenItem[],
  tickets: readonly CoverageTicket<Id>[],
): SpecTicketCoverage<Id> {
  const live = tickets
    .filter((t) => !t.isBackstop && !isCodeChangeBackstopTitle(t.title) && !DEAD_STATUSES.has(t.status.trim().toLowerCase()))
    .map((t) => ({ id: t.id, text: `${t.title}\n${t.description ?? ''}`, normalized: normalizeTitle(t.title), tokens: titleTokens(t.title) }));
  const covered: SpecTicketCoverage<Id>['covered'] = [];
  const missing: SpecOpenItem[] = [];
  for (const item of specItemsOwingTickets(openItems)) {
    const byId = matchableId(item.id) ? idPattern(item.id) : null;
    const normalized = normalizeTitle(item.title);
    const tokens = titleTokens(item.title);
    const ticketIds = live
      .filter((t) => byId?.test(t.text) || t.normalized === normalized || areNearDuplicateTokens(tokens, t.tokens))
      .map((t) => t.id);
    if (ticketIds.length) covered.push({ itemId: item.id, ticketIds });
    else missing.push(item);
  }
  return { covered, missing };
}
