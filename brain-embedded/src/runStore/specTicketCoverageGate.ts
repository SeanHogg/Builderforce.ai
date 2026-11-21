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
 * WHEN it is active: the request has BOTH ticketing language ({@link TICKETING_INTENTS}) AND spec language ({@link SPEC_LANGUAGE})
 * or a named `.md` spec; the spec is the one it names, else (only when it speaks of a spec) one the run read. It then reads the
 * spec through the run's own `read_file` (the host's repo read; the parse is cached per run until the run writes that path),
 * parses its open items and joins them with the chat's linked tickets (`listChatTickets`, the listing the open-work hold reads)
 * plus the tickets this run filed (a filed ticket the listing already shows counts by BOTH its listed title and its filed
 * title/description) — the shared `parseSpecOpenItems` + `specTicketCoverage` (`@builderforce/agent-tools`, the pair the api's
 * `roadmap.align_tickets` spec mode reads). The run's delta ticket and every "Code change (N files)" ticket never cover an item.
 *
 * Bounded, per DISTINCT missing set: the first time it is seen the run is held with the list and told to file one ticket per
 * item; the first repeat holds once more only to require the final report to LIST the unticketed items (skipped when the answer
 * already lists them); the second repeat releases. At most {@link MAX_SPEC_COVERAGE_HOLDS} holds per run. Stands down for a
 * sub-agent, a `chat`-mode run, an aborted run, a turn that asks the person, a host with no tool runner, and a spec or ticket
 * listing that cannot be read (the failure is noted on the run, never a hold).
 */

import type { PolicyContext } from '@builderforce/agent-run';
import { editedPathsOf, isMatchableSpecItemId, parseSpecOpenItems, specTicketCoverage, type CoverageTicket, type SpecOpenItem } from '@builderforce/agent-tools';
import { normalizeChatMode } from '../chatMode';
import { declaresChatTicketListing, linkedTaskRows } from '../chatWorkLinking';
import { errorMessage } from '../pageEngines/types';
import { SERVER_TICKET_CREATE_TOOL } from '../ticketToolVocabulary';
import { isFailedToolResult } from '../toolFailure';
import { toolResultRecord } from '../toolResultRecord';
import type { BrainTraceEvent } from '../brainTriage';
import { readFileAnchors } from './answerAnchors';
import type { BrainRunContext } from './brainRunContext';
import { isCodeChangeTool } from '../localWorkspaceTools';
import { latestStatus, listChatTickets, listingScopeOf, stepSucceeded, ticketMovesInRun, ticketsCreatedInRun } from './chatTickets';
import { bounded, continuationLimits } from './deadline';
import { asksThePerson } from './openLinkedWorkHold';
import { TICKETING_INTENTS } from '../workItemBookkeeping';
import { nowIso, pushTrace, runTrace } from './runCells';

/** SPEC language — the request is about a spec document (a named `.md` spec path counts too, {@link namedSpecPaths}). */
export const SPEC_LANGUAGE: readonly RegExp[] = [
  /\bspecs?\b/i,
  /\bspecification\b/i,
  /\bprds?\b/i,
  /\broadmap\b/i,
  /\bgap register\b/i,
  /\brequirements? doc(?:ument)?s?\b/i,
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
/**
 * A read markdown file that looks like a spec: under `docs/specs/`, or with `spec` / `prd` / `roadmap` / `requirements` as a WORD
 * of its path (`measure-spec.md`, `PRD-25.md`, `ROADMAP.md`) — never inside one (`inspect.md`).
 */
const SPEC_LIKE = /(?:^|\/)docs\/specs?\/|(?:^|[^a-z])(?:specs?|prds?|roadmap|requirements)(?=[^a-z]|$)/i;

const normalizePath = (p: string): string => p.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');

/** The markdown specs the request names by path (never a README, CHANGELOG …). */
function namedSpecPaths(request: string): string[] {
  return [...new Set((request.match(MD_PATH) ?? []).map(normalizePath))].filter((p) => !NOT_A_SPEC.test(p));
}

/** Does the request speak of a spec (spec / PRD / roadmap / gap register / requirements doc)? */
const speaksOfSpec = (request: string): boolean => SPEC_LANGUAGE.some((p) => p.test(request));

/** Does the request ask to ticket a spec's open items? BOTH ticketing language AND spec language (or a named `.md` spec). */
export function isSpecTicketingRequest(request: string): boolean {
  return TICKETING_INTENTS.some((p) => p.test(request)) && (speaksOfSpec(request) || namedSpecPaths(request).length > 0);
}

/**
 * The specs the run is about: the ones the request names, else — only when the request speaks of a spec — the spec-like markdown
 * the run read (latest first).
 */
export function specPathsFor(request: string, trace: readonly BrainTraceEvent[]): string[] {
  const named = namedSpecPaths(request);
  if (named.length) return named.slice(0, MAX_SPECS);
  if (!speaksOfSpec(request)) return [];
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

/** An item listed by its id when it has one; a title-only item (a derived slug id) is listed by its title alone. */
function itemLine(i: MissingItem): string {
  const blocker = i.status === 'blocked' ? `, blocker: ${i.blocker ?? 'not stated'}` : '';
  const id = isMatchableSpecItemId(i.id) ? `${i.id} ` : '';
  return `- ${id}"${i.title}" (${i.status}${blocker}; ${i.spec}:${i.line})`;
}

function itemList(missing: readonly MissingItem[]): string {
  const shown = missing.slice(0, MAX_LISTED_ITEMS).map(itemLine);
  if (missing.length > MAX_LISTED_ITEMS) shown.push(`- +${missing.length - MAX_LISTED_ITEMS} more`);
  return shown.join('\n');
}

/** The block that holds the run: the unticketed items, and how to ticket them. */
function fileTicketsBlock(missing: readonly MissingItem[]): string {
  const withId = missing.find((i) => isMatchableSpecItemId(i.id));
  const example = withId ? ` (e.g. "${withId.id}: ${withId.title}")` : '';
  return (
    `You were asked to create a ticket for each open item of the spec, and these open items have NO ticket linked to this chat:\n${itemList(missing)}\n\n` +
    `File ONE ticket per item now (${SERVER_TICKET_CREATE_TOOL}), linked to this chat. Start each ticket title with the item's id when the item has one${example}; ` +
    'for an item listed without an id, copy the item title verbatim as the ticket title. ' +
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
 * The tickets the coverage join reads: the chat's linked task-tier tickets UNION the ones this run filed. A filed ticket the
 * listing already carries is a second row under the LISTED ref and lane, so its filed title/description (where the model wrote the
 * item id) counts as well as the listed title. The run's delta ticket is a backstop. Null when the listing cannot be read.
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
  const listedByRef = new Map(listedRows.map((t) => [t.id, t]));
  const moves = ticketMovesInRun(trace);
  const filed = ticketsCreatedInRun(trace).map((f): CoverageTicket<string> => {
    const text = (k: string) => (typeof f.args[k] === 'string' ? (f.args[k] as string) : '');
    const listed = f.syncRef != null ? listedByRef.get(f.syncRef) : undefined;
    return {
      id: listed ? listed.id : f.ref,
      title: text('title') || text('summary'),
      description: text('description') || text('detail'),
      status: listed ? listed.status : (latestStatus(moves, f.ids) ?? (text('status') || 'backlog')),
      ...(listed?.isBackstop ? { isBackstop: true } : {}),
    };
  });
  return [...listedRows, ...filed];
}

const samePath = (a: string, b: string): boolean => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);

/** Did one of these steps write or edit `path` (the run's own workspace writers)? */
function writesPath(events: readonly BrainTraceEvent[], path: string): boolean {
  return events.some((ev) => stepSucceeded(ev) && isCodeChangeTool(ev.label) && editedPathsOf(ev.label, ev.args).some((p) => samePath(normalizePath(p), path)));
}

/**
 * The spec-coverage finish port for one Brain run, registered beside the open-work hold (`run/runPrepared.ts`). Its counts, and
 * the parsed specs (one read per spec until the run writes that path), live with the port, which the run builds once.
 */
export function specTicketCoverageGate(run: BrainRunContext): (ctx: PolicyContext) => Promise<string | null> {
  const seen = new Map<string, number>();
  /** Parsed spec items by path, with the run-trace length at the read: a later write/edit to the path re-reads it. */
  const parsedSpecs = new Map<string, { items: SpecOpenItem[]; at: number }>();
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
  const specItems = async (spec: string, trace: readonly BrainTraceEvent[]): Promise<SpecOpenItem[] | null> => {
    const cached = parsedSpecs.get(spec);
    if (cached && cached.at <= trace.length && !writesPath(trace.slice(cached.at), spec)) return cached.items;
    const text = await readSpec(run, spec, note);
    if (text == null) {
      parsedSpecs.delete(spec);
      return null;
    }
    const items = parseSpecOpenItems(text);
    parsedSpecs.set(spec, { items, at: trace.length });
    return items;
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
      const list = await specItems(spec, trace);
      if (list != null) items.push({ spec, items: list });
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
