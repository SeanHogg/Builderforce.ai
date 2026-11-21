/**
 * "Are the open tickets aligned with the roadmap and the specs?" — answered in one pass.
 *
 * An agent asked to validate every open ticket against `ROADMAP.md` and the spec files
 * read 106 of 584 roadmap lines by hand and gave up. This joins the parsed gap register
 * ({@link parseGapRegister}) with a project's open tickets and the spec files' headings,
 * and returns the three lists that question is really asking for: gaps no ticket covers,
 * tickets no gap backs, and gap links that point at a spec heading that does not exist.
 *
 * ── HOW A TICKET MATCHES A GAP ───────────────────────────────────────────────────
 *   (a) its title or description contains the gap's id, or the gap's exact spec link
 *       (`docs/specs/make.md#anchor`, with or without the leading `./`); or
 *   (b) its title is the same work as the gap's summary under the ONE near-duplicate
 *       title rule (`domain/shared/nearDuplicateTitle.ts`) — the rule every idempotent
 *       `*.create` dedups with, so "matches a gap" and "would be deduped against it"
 *       cannot drift apart.
 * A link to a whole file (no anchor) never matches by itself: one spec file backs
 * dozens of gaps.
 *
 * ── FAN-OUT COPIES AND CHILDREN ──────────────────────────────────────────────────
 * A persona fan-out copy restates its source ticket; it is excluded outright. A child
 * whose parent (or any open ancestor) matched is the parent's work broken down: it is
 * counted under the parent's gaps (`childTaskIds`) and never reported as unbacked.
 *
 * Pure: no db, no env.
 */
import {
  parseGapRegister,
  parseSpecAnchors,
  type GapEntry,
} from '../../domain/roadmap/gapRegister';
import { areNearDuplicateTokens, normalizeTitle, titleTokens } from '../../domain/shared/nearDuplicateTitle';

export interface AlignTicket {
  id: number;
  title: string;
  description: string | null;
  status: string;
  parentTaskId: number | null;
  /** A persona fan-out copy — excluded. The tool already filters these in SQL. */
  isFanoutCopy?: boolean;
}

export interface AlignTicketsInput {
  tenantId: number;
  projectId: number;
  roadmapMarkdown: string;
  /** Spec markdown keyed by the file as the roadmap links it (`docs/specs/make.md`). */
  specs: Record<string, string>;
  openTickets: readonly AlignTicket[];
  /** Pre-parsed register (a cache hit); parsed from `roadmapMarkdown` when absent. */
  gaps?: readonly GapEntry[];
  /** Pre-parsed anchors per spec file (a cache hit); parsed from `specs` when absent. */
  specAnchors?: Record<string, readonly string[]>;
  /** Linked files known to EXIST but not read (too large, over a cap): neither missing
   *  nor checkable, so their links are reported under neither list. */
  unreadableSpecFiles?: readonly string[];
}

/** Most rows any one output list carries. */
export const ALIGN_LIST_CAP = 200;

export interface CappedList<T> {
  items: T[];
  total: number;
  truncated: boolean;
}

export interface AlignTicketsResult {
  projectId: number;
  gaps: number;
  tickets: number;
  gapsByStage: Record<string, number>;
  matched: CappedList<{ gapId: string; taskIds: number[]; childTaskIds: number[] }>;
  gapsWithoutTicket: CappedList<{ gapId: string; stage: string; summary: string; line: number }>;
  ticketsWithoutGap: CappedList<{ id: number; title: string }>;
  danglingSpecLinks: CappedList<{ gapId: string; file: string; anchor: string }>;
  specFilesMissing: CappedList<string>;
}

function capped<T>(all: T[], cap = ALIGN_LIST_CAP): CappedList<T> {
  return { items: all.slice(0, cap), total: all.length, truncated: all.length > cap };
}

/** The anchors of every spec, from the cache or parsed now. */
export function specAnchorsOf(specs: Record<string, string>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(specs).map(([file, md]) => [file, [...parseSpecAnchors(md)]]));
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Gap ids each ticket matches directly (rules a and b), before parent folding. */
function directMatches(gaps: readonly GapEntry[], tickets: readonly AlignTicket[]): Map<number, Set<string>> {
  const needles = gaps.map((g) => ({
    id: g.id,
    // On a token boundary: `make/foo` must not match inside `make/foo-2` or `x/make/foo`.
    idPattern: new RegExp(`(?<![\\w/-])${escapeRegExp(g.id.toLowerCase())}(?![\\w-])`),
    links: g.specLinks.filter((l) => l.anchor).map((l) => `${l.file}#${l.anchor}`.toLowerCase()),
    normalized: normalizeTitle(g.summary),
    tokens: titleTokens(g.summary),
  }));
  const out = new Map<number, Set<string>>();
  for (const t of tickets) {
    const text = `${t.title}\n${t.description ?? ''}`.toLowerCase();
    const normalized = normalizeTitle(t.title);
    const tokens = titleTokens(t.title);
    const hits = new Set<string>();
    for (const n of needles) {
      if (
        n.idPattern.test(text)
        || n.links.some((link) => text.includes(link))
        || normalized === n.normalized
        || areNearDuplicateTokens(tokens, n.tokens)
      ) hits.add(n.id);
    }
    if (hits.size > 0) out.set(t.id, hits);
  }
  return out;
}

/** The nearest open ancestor of `id` that matched directly, or null. Cycle-safe. */
function matchedAncestor(id: number, parentOf: Map<number, number | null>, direct: Map<number, Set<string>>): number | null {
  const seen = new Set<number>([id]);
  for (let p = parentOf.get(id) ?? null; p != null && !seen.has(p); p = parentOf.get(p) ?? null) {
    if (direct.has(p)) return p;
    seen.add(p);
  }
  return null;
}

export function alignTicketsToRoadmap(input: AlignTicketsInput): AlignTicketsResult {
  const gaps = input.gaps ?? parseGapRegister(input.roadmapMarkdown);
  const anchors = input.specAnchors ?? specAnchorsOf(input.specs);
  const tickets = input.openTickets.filter((t) => t.isFanoutCopy !== true);

  const parentOf = new Map(tickets.map((t) => [t.id, t.parentTaskId]));
  const direct = directMatches(gaps, tickets);

  const taskIdsByGap = new Map<string, number[]>();
  const childIdsByGap = new Map<string, number[]>();
  const unbacked: Array<{ id: number; title: string }> = [];
  const push = (m: Map<string, number[]>, gapId: string, id: number) => {
    const list = m.get(gapId) ?? [];
    list.push(id);
    m.set(gapId, list);
  };

  for (const t of tickets) {
    const ancestor = matchedAncestor(t.id, parentOf, direct);
    if (ancestor != null) {
      // The parent's gaps, plus any gap the child matches on its own — a gap reached only
      // through a child is still covered.
      for (const gapId of new Set([...direct.get(ancestor)!, ...(direct.get(t.id) ?? [])])) push(childIdsByGap, gapId, t.id);
      continue;
    }
    const hits = direct.get(t.id);
    if (!hits) {
      unbacked.push({ id: t.id, title: t.title });
      continue;
    }
    for (const gapId of hits) push(taskIdsByGap, gapId, t.id);
  }

  const gapsByStage: Record<string, number> = {};
  const dangling: Array<{ gapId: string; file: string; anchor: string }> = [];
  const missing = new Set<string>();
  const anchorSets = new Map(Object.entries(anchors).map(([f, list]) => [f, new Set(list)]));
  const unreadable = new Set(input.unreadableSpecFiles ?? []);
  for (const g of gaps) {
    gapsByStage[g.stage] = (gapsByStage[g.stage] ?? 0) + 1;
    for (const link of g.specLinks) {
      if (unreadable.has(link.file)) continue;
      const set = anchorSets.get(link.file);
      if (!set) {
        missing.add(link.file);
        continue;
      }
      if (link.anchor && !set.has(link.anchor)) dangling.push({ gapId: g.id, file: link.file, anchor: link.anchor });
    }
  }

  const covered = (g: GapEntry) => taskIdsByGap.has(g.id) || childIdsByGap.has(g.id);
  const matched = gaps
    .filter(covered)
    .map((g) => ({ gapId: g.id, taskIds: taskIdsByGap.get(g.id) ?? [], childTaskIds: childIdsByGap.get(g.id) ?? [] }));

  return {
    projectId: input.projectId,
    gaps: gaps.length,
    tickets: tickets.length,
    gapsByStage,
    matched: capped(matched),
    gapsWithoutTicket: capped(
      gaps.filter((g) => !covered(g)).map((g) => ({ gapId: g.id, stage: g.stage, summary: g.summary, line: g.line })),
    ),
    ticketsWithoutGap: capped(unbacked),
    danglingSpecLinks: capped(dangling),
    specFilesMissing: capped([...missing].sort()),
  };
}
