/**
 * The idea log — the pure half of the Ideas surface.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────────────────
 * An `idea` is a founder spec kind (`founderObjects.ts`) like any other card on the
 * board. What a scratchpad adds is the READING: every idea on the board at once, newest
 * first, grouped by where it is in its life, with the ones nobody has tested called out.
 * That reading is arithmetic over the board's objects, so it lives here — no React, no
 * catalog — and the surface (`CanvasIdeasSurface`) and the `idea` spec's own `evidence`
 * derivation both read it. One answer to "which refs tested this idea", in one place.
 *
 * ── WHY THE STAGE IS NORMALISED AND NOT TRUSTED ──────────────────────────────────
 * `stage` is authored — by a person in the surface's select, and by Brain in a patch.
 * A value outside `IDEA_STAGES` (a typo, a model's "in progress") must not make an idea
 * vanish from every stage filter, so an unknown stage reads as `captured`: the stage
 * that claims the least. The card still shows what was written; only the COUNT is
 * normalised.
 */

import { IDEA_STAGES, isIdeaStage, type IdeaStage } from '@builderforce/creation-canvas-contract';
import { specRefKey } from './specObjects';

/** The kind this log reads. */
export const IDEA_KIND = 'idea';

/** The kinds whose objects count as evidence for an idea, in the order a founder
 *  usually gathers them: talk to someone, then run something. */
export const IDEA_EVIDENCE_KINDS = ['customerInterview', 'experiment'] as const;

/** Stages in which an idea is still being worked on — the ones "untested" is about. An
 *  exit stage with no evidence is a decision someone already made, not a gap. */
export const IDEA_OPEN_STAGES: readonly IdeaStage[] = ['captured', 'exploring', 'validating'];

/** A title longer than this is a paragraph, and the card header is one line. */
const TITLE_MAX = 80;

export interface IdeaLogNode {
  id: string;
  data: Readonly<Record<string, unknown>>;
}

export interface IdeaLogEntry {
  id: string;
  data: Readonly<Record<string, unknown>>;
  stage: IdeaStage;
  /** ISO instant the idea was written down, or null for an idea authored without one. */
  capturedAt: string | null;
  /** The evidence refs the idea names — see {@link ideaTestedBy}. */
  testedBy: readonly string[];
}

/** An idea's stage, with anything outside the vocabulary read as `captured`. */
export function ideaStage(data: Readonly<Record<string, unknown>>): IdeaStage {
  return isIdeaStage(data.stage) ? data.stage : 'captured';
}

/**
 * The `customerInterview` / `experiment` titles an idea says tested it.
 *
 * `testedBy` is a `chips` field, so the stored shape is `string[]` — but a model
 * occasionally writes one comma-separated string, and silently counting that as ONE
 * ref would report a tested idea as tested by something that does not exist.
 */
export function ideaTestedBy(data: Readonly<Record<string, unknown>>): string[] {
  const raw = data.testedBy;
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const value of values) {
    const ref = typeof value === 'string' ? value.trim() : '';
    const key = specRefKey(ref);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

/** `testedBy` with one more ref, deduplicated the way the board matches refs. */
export function withTestedBy(data: Readonly<Record<string, unknown>>, ref: string): string[] {
  const refs = ideaTestedBy(data);
  const key = specRefKey(ref);
  return key && !refs.some((existing) => specRefKey(existing) === key) ? [...refs, ref.trim()] : refs;
}

/**
 * What a line typed into the scratchpad becomes.
 *
 * The first non-empty line is the title (clipped to one card-header line); the WHOLE
 * text is the `scratch`, verbatim, because the scratch is the record of how the idea
 * started and a tidied copy is what `problem` and `summary` are for. Null for blank input
 * so the caller cannot add an empty card.
 */
export function ideaFromScratch(text: string, now: Date = new Date()): {
  title: string; scratch: string; stage: IdeaStage; capturedAt: string;
} | null {
  const scratch = text.trim();
  if (!scratch) return null;
  const firstLine = scratch.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? scratch;
  const title = firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1).trimEnd()}…` : firstLine;
  return { title, scratch, stage: 'captured', capturedAt: now.toISOString() };
}

function capturedInstant(data: Readonly<Record<string, unknown>>): string | null {
  const value = typeof data.capturedAt === 'string' ? data.capturedAt.trim() : '';
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * Every idea on the board, newest first.
 *
 * An idea with no `capturedAt` (authored before the field existed, or by a model that
 * left it out) sorts AFTER every dated one rather than first — undated is not "newest".
 * Ties keep board order, so the list does not reshuffle while someone is reading it.
 */
export function ideaLogEntries(nodes: readonly IdeaLogNode[]): IdeaLogEntry[] {
  const entries = nodes
    .filter((node) => node.data.kind === IDEA_KIND)
    .map((node, index) => ({
      index,
      entry: {
        id: node.id,
        data: node.data,
        stage: ideaStage(node.data),
        capturedAt: capturedInstant(node.data),
        testedBy: ideaTestedBy(node.data),
      } satisfies IdeaLogEntry,
    }));
  entries.sort((a, b) => {
    const at = a.entry.capturedAt ? Date.parse(a.entry.capturedAt) : null;
    const bt = b.entry.capturedAt ? Date.parse(b.entry.capturedAt) : null;
    if (at !== null && bt !== null && at !== bt) return bt - at;
    if (at === null && bt !== null) return 1;
    if (at !== null && bt === null) return -1;
    return a.index - b.index;
  });
  return entries.map(({ entry }) => entry);
}

/** How many ideas sit at each stage. Every stage is present, zero included, so a
 *  distribution bar never has to guess which segments exist. */
export function ideaStageCounts(entries: readonly IdeaLogEntry[]): Record<IdeaStage, number> {
  const counts = Object.fromEntries(IDEA_STAGES.map((stage) => [stage, 0])) as Record<IdeaStage, number>;
  for (const entry of entries) counts[entry.stage] += 1;
  return counts;
}

/**
 * Open ideas that name no evidence at all — the actionable number on the surface.
 *
 * Deliberately "names no ref", not "no ref resolves": a ref to an interview that has not
 * been written up yet is still a conversation somebody planned, and the card's own
 * `evidence` verdict is where a dangling ref is called out.
 */
export function untestedIdeaCount(entries: readonly IdeaLogEntry[]): number {
  return entries.filter((entry) => IDEA_OPEN_STAGES.includes(entry.stage) && entry.testedBy.length === 0).length;
}
