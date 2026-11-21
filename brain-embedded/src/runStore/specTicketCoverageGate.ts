/**
 * SPEC TICKET COVERAGE GATE — a run asked to ticket a spec's open items may not end while one of them has no ticket.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Chat #157440: "restructure docs/specs/measure.md to have a section that outlines the features and tasks … update that section
 * with the current status … For all the items that are incomplete, create associated tickets to this chat". The run ended with
 * P25-09, OUT-02, OUT-03 and the blocked P25-14, P33-01, P33-02, P33-03 holding no ticket. Nothing compared the spec's open rows
 * with the chat's tickets — the open-work hold (`openLinkedWorkHold.ts`) only reads tickets that already exist — and the run's
 * auto-captured "Code change (N files) from Brain chat #N" ticket made the work LOOK linked.
 *
 * WHEN it is active: the request asks to ticket a spec's open items ({@link SPEC_TICKETING_INTENTS}) AND names a markdown spec
 * (or the run read one). It then reads the spec through the run's own `read_file` (the host's repo read), parses its open items
 * and joins them with the chat's linked tickets (`listChatTickets`, the listing the open-work hold reads) plus the tickets this
 * run filed — the shared `parseSpecOpenItems` + `specTicketCoverage` (`@builderforce/agent-tools`, the pair the api's
 * `roadmap.align_tickets` spec mode reads). The run's delta ticket and every "Code change (N files)" ticket never cover an item.
 *
 * Bounded, per DISTINCT missing set: the first time it is seen the run is held with the list and told to file one ticket per
 * item; the first repeat holds once more only to require the final report to LIST the unticketed items (skipped when the answer
 * already lists them); the second repeat releases. At most {@link MAX_SPEC_COVERAGE_HOLDS} holds per run. Stands down for a
 * sub-agent, a `chat`-mode run, an aborted run, a turn that asks the person, a host with no tool runner, and a spec or ticket
 * listing that cannot be read (the failure is noted on the run, never a hold).
 */

import type { PolicyContext } from '@builderforce/agent-run';
import { parseSpecOpenItems, specTicketCoverage, type CoverageTicket, type SpecOpenItem } from '@builderforce/agent-tools';
import { normalizeChatMode } from '../chatMode';
import { declaresChatTicketListing, linkedTaskRows } from '../chatWorkLinking';
import { errorMessage } from '../pageEngines/types';
import { SERVER_TICKET_CREATE_TOOL } from '../ticketToolVocabulary';
import { isFailedToolResult } from '../toolFailure';
import { toolResultRecord } from '../toolResultRecord';
import type { BrainTraceEvent } from '../brainTriage';
import { readFileAnchors } from './answerAnchors';
import type { BrainRunContext } from './brainRunContext';
import { latestStatus, listChatTickets, listingScopeOf, ticketMovesInRun, ticketsCreatedInRun } from './chatTickets';
import { bounded, continuationLimits } from './deadline';
import { asksThePerson } from './openLinkedWorkHold';
import { nowIso, pushTrace, runTrace } from './runCells';

/**
 * Requests that ask to ticket a spec's open items — data, not logic. The first three are chat #157440's own words; the rest are
 * the common phrasings of the same ask.
 */
export const SPEC_TICKETING_INTENTS: readonly RegExp[] = [
  /\bsection that outlines the features and tasks\b/i,
  /\bupdate (?:that|the) section with the current status\b/i,
  /\bitems that are incomplete,? create (?:the )?associated tickets\b/i,
  /\bcreate (?:the |associated |linked |separate )?tickets? for\b/i,
  /\bcreate (?:the )?associated tickets\b/i,
  /\bopen items\b/i,
  /\bincomplete items\b/i,
];

/** The most times one run is held for unticketed spec items. */
export const MAX_SPEC_COVERAGE_HOLDS = 4;
/** The most specs one finish reads. */
const MAX_SPECS = 3;
/** Lines asked for per `read_file` page, and the most pages one spec is read in. */
const PAGE_LINES = 2000;
const MAX_PAGES = 10;
/** The most items the block lists by name; the rest are counted. */
const MAX_LISTED_ITEMS = 25;

/** Markdown files that are never a spec. */
const NOT_A_SPEC = /(^|\/)(readme|changelog|license|contributing|claude|agents|memory|code_of_conduct|security)\.md$/i;
/** A markdown path as written in a request (`docs/specs/measure.md`, `[docs\specs\measure.md]`). */
const MD_PATH = /[\w.@-]+(?:[\\/][\w.@-]+)*\.md\b/gi;
/** A read markdown file that looks like a spec: under a docs/spec/prd folder, or named for one. */
const SPEC_LIKE = /(^|\/)(docs?|specs?|prds?)\/|spec|prd|roadmap/i;

/** Does the request ask to ticket a spec's open items? */
export function isSpecTicketingRequest(request: string): boolean {
  return SPEC_TICKETING_INTENTS.some((p) => p.test(request));
}

const normalizePath = (p: string): string => p.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');

/** The specs the run is about: the ones the request names, else the spec-like markdown the run read (latest first). */
export function specPathsFor(request: string, trace: readonly BrainTraceEvent[]): string[] {
  const named = [...new Set((request.match(MD_PATH) ?? []).map(normalizePath))].filter((p) => !NOT_A_SPEC.test(p));
  if (named.length) return named.slice(0, MAX_SPECS);
  return readFileAnchors(trace)
    .map((a) => normalizePath(a.path))
    .filter((p) => /\.md$/i.test(p) && !NOT_A_SPEC.test(p) && SPEC_LIKE.test(p))
    .reverse()
    .slice(0, MAX_SPECS);
}

/** One item the run still owes a ticket for, with the spec it came from. */
interface MissingItem extends SpecOpenItem {
  spec: string;
}

function itemLine(i: MissingItem): string {
  const blocker = i.status === 'blocked' ? `, blocker: ${i.blocker ?? 'not stated'}` : '';
  return `- ${i.id} "${i.title}" (${i.status}${blocker}; ${i.spec}:${i.line})`;
}

function itemList(missing: readonly MissingItem[]): string {
  const shown = missing.slice(0, MAX_LISTED_ITEMS).map(itemLine);
  if (missing.length > MAX_LISTED_ITEMS) shown.push(`- +${missing.length - MAX_LISTED_ITEMS} more`);
  return shown.join('\n');
}

/** The block that holds the run: the unticketed items, and how to ticket them. */
function fileTicketsBlock(missing: readonly MissingItem[]): string {
  return (
    `You were asked to create a ticket for each open item of the spec, and these open items have NO ticket linked to this chat:\n${itemList(missing)}\n\n` +
    `File ONE ticket per item now (${SERVER_TICKET_CREATE_TOOL}), linked to this chat, with the item id in the title (e.g. "${missing[0]!.id}: ${missing[0]!.title}"). ` +
    'File a BLOCKED item with status "blocked" and name its blocker in the description. ' +
    'An auto-captured "Code change (N files)" ticket records a diff, not a spec item: it does not count. Then continue with the remaining work.'
  );
}

/** The last hold for a repeated set: the run may end, but its report must say what was not ticketed. */
function reportBlock(missing: readonly MissingItem[]): string {
  return (
    `These spec items still have no ticket:\n${itemList(missing)}\n\n` +
    'If you cannot file them, end the run now — and your final report MUST list each of these unticketed items (id, title, status, line) and why it has no ticket.'
  );
}

/** Does the answer already list every missing item (by id, or by title for an item with no token)? */
function listsAll(content: string | undefined, missing: readonly MissingItem[]): boolean {
  const text = (content ?? '').toLowerCase();
  return missing.every((i) => text.includes(i.id.toLowerCase()) || text.includes(i.title.toLowerCase()));
}

/** The whole text of a file read through the run's `read_file`, page by page; null (with a note) when it cannot be read. */
async function readSpec(run: BrainRunContext, path: string, note: (label: string, result: string, args?: Record<string, unknown>) => void): Promise<string | null> {
  const runTool = run.req.runTool!;
  const parts: string[] = [];
  let offset = 1;
  for (let page = 0; page < MAX_PAGES; page++) {
    let out: unknown;
    try {
      out = await bounded(continuationLimits.settleMs, runTool('read_file', { path, offset, limit: PAGE_LINES }));
    } catch (e) {
      out = { ok: false, error: errorMessage(e) };
    }
    const rec = toolResultRecord(out);
    if (isFailedToolResult(out) || !rec || typeof rec.content !== 'string') {
      const why = typeof rec?.error === 'string' ? ` (${rec.error})` : '';
      note('finish.spec_tickets_unreadable', `The spec ${path} could not be read${why}: the run is not held for its open items.`, { path });
      return null;
    }
    parts.push(rec.content);
    const returned = rec.content.split('\n').length;
    const total = typeof rec.totalLines === 'number' ? rec.totalLines : 0;
    offset += returned;
    if (rec.truncated !== true || offset > total) break;
  }
  return parts.join('\n');
}

/**
 * The tickets the coverage join reads: the chat's linked task-tier tickets plus the ones this run filed that the listing does not
 * carry yet. The run's delta ticket is a backstop. Null when the listing cannot be read.
 */
async function coverageTickets(run: BrainRunContext, trace: readonly BrainTraceEvent[], noteEv: (ev: BrainTraceEvent) => void): Promise<CoverageTicket<string>[] | null> {
  const delta = run.c.deltaTicketId != null ? String(run.c.deltaTicketId) : null;
  const listedRows: CoverageTicket<string>[] = [];
  if (run.serverChatId != null) {
    const listed = await listChatTickets(run.req, run.serverChatId, {
      note: noteEv, label: 'finish.spec_tickets_unreadable', consequence: 'the run is not held for the spec\'s open items.',
      timeoutMs: continuationLimits.settleMs,
    }, listingScopeOf(run.c));
    if (listed == null) return null;
    for (const t of linkedTaskRows(listed)) listedRows.push({ id: t.ref, title: t.title, status: t.status, isBackstop: t.ref === delta });
  }
  const listedRefs = new Set(listedRows.map((t) => t.id));
  const moves = ticketMovesInRun(trace);
  const filed = ticketsCreatedInRun(trace)
    .filter((f) => f.syncRef == null || !listedRefs.has(f.syncRef))
    .map((f): CoverageTicket<string> => {
      const text = (k: string) => (typeof f.args[k] === 'string' ? (f.args[k] as string) : '');
      return {
        id: f.ref,
        title: text('title') || text('summary'),
        description: text('description') || text('detail'),
        status: latestStatus(moves, f.ids) ?? (text('status') || 'backlog'),
      };
    });
  return [...listedRows, ...filed];
}

/**
 * The spec-coverage finish port for one Brain run, registered beside the open-work hold (`run/runPrepared.ts`). Its counts live
 * with the port, which the run builds once.
 */
export function specTicketCoverageGate(run: BrainRunContext): (ctx: PolicyContext) => Promise<string | null> {
  const seen = new Map<string, number>();
  let holds = 0;
  let released = false;

  const noteEv = (ev: BrainTraceEvent): void => pushTrace(run.c, ev);
  const note = (label: string, result: string, args?: Record<string, unknown>): void => {
    noteEv({ ts: nowIso(), category: 'message', label, ...(args ? { args } : {}), result });
  };
  const release = (missing: readonly MissingItem[], why: string): null => {
    released = true;
    note('finish.spec_tickets_released', `The run ends with spec items still unticketed (${missing.map((i) => i.id).join(', ')}): released because ${why}.`, { missing: missing.map((i) => i.id) });
    return null;
  };

  return async (ctx) => {
    const { req } = run;
    if (released || !req.runTool) return null;
    if (req.lineage || ctx.task.dispatch.parentRunId !== undefined) return null;
    if (normalizeChatMode(req.chatMode ?? 'work') !== 'work') return null;
    if (run.c.abort?.signal.aborted || ctx.signal?.aborted) return null;
    if (asksThePerson(ctx.content)) return null;
    if (!isSpecTicketingRequest(run.userRequest)) return null;
    // A bound chat whose host declares no listing: the chat's tickets cannot be read, so nothing can be said to be missing.
    if (run.serverChatId != null && !declaresChatTicketListing(req.tools)) return null;

    const trace = runTrace(run.c);
    const specs = specPathsFor(run.userRequest, trace);
    if (!specs.length) return null;
    const items: Array<{ spec: string; items: SpecOpenItem[] }> = [];
    for (const spec of specs) {
      const text = await readSpec(run, spec, note);
      if (text != null) items.push({ spec, items: parseSpecOpenItems(text) });
    }
    if (!items.length) return null;
    const tickets = await coverageTickets(run, trace, noteEv);
    if (!tickets) return null;
    const missing: MissingItem[] = items.flatMap(({ spec, items: list }) => specTicketCoverage(list, tickets).missing.map((i) => ({ ...i, spec })));
    if (!missing.length) return null;

    const key = missing.map((i) => `${i.spec}#${i.id}`).sort().join('|');
    const times = (seen.get(key) ?? 0) + 1;
    seen.set(key, times);
    if (times >= 3) return release(missing, 'the same items stayed unticketed after two holds');
    if (times === 2 && listsAll(ctx.content, missing)) return release(missing, 'the final report lists them');
    if (holds >= MAX_SPEC_COVERAGE_HOLDS) return release(missing, `it was already held ${holds} times`);
    holds += 1;
    note('finish.spec_tickets_held', `The run was held for ${missing.length} unticketed spec item(s) (${holds}/${MAX_SPEC_COVERAGE_HOLDS}).`, {
      missing: missing.map((i) => ({ id: i.id, status: i.status, spec: i.spec, line: i.line })), repeat: times > 1,
    });
    return times === 1 ? fileTicketsBlock(missing) : reportBlock(missing);
  };
}
