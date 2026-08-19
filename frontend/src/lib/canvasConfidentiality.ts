/**
 * THE decision about whether a canvas object may leave the board.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * The People vocabulary declared a complete confidentiality model — three ranked levels,
 * a per-kind default, a restricted-by-default list that deliberately reaches across into
 * the hiring and operations vocabularies, and ONE comparison written so that no caller
 * would re-derive the ranking. Then nothing called it. `confidentiality` sat on every
 * people spec as a field the author could set and no boundary could read, which is worse
 * than having no model at all: the board displayed a label that implied an enforcement
 * that did not exist.
 *
 * Five boundaries had to ask and none did — document export, the public share link, the
 * guest surface's advertised object set, the Drive push, and the AI context snapshot a
 * model may quote back into a transcript. The contract now names those five
 * (`CANVAS_BOUNDARIES`) and states each one's ceiling (`BOUNDARY_CEILING`); this module
 * is what turns a boundary and a pile of board objects into an answer, so the five agree
 * by construction rather than by five people writing the same `if` five times.
 *
 * ── WHY A PARTITION AND NOT A FILTER ────────────────────────────────────────────
 * `withheld` is returned beside `allowed` because silently dropping a card is how an
 * export comes to be missing a page nobody notices. Every caller gets the list of what
 * was held back and why, so the surface can SAY so — the same argument
 * `emptyShellProblem()` makes about blank cards and `DerivedProvenance` makes about
 * truncated numbers: a quiet omission is worse than a visible one.
 *
 * Pure — no React, no fetch — so the policy is unit-testable as a table.
 */

import {
  BOUNDARY_CEILING,
  boundaryAdmits,
  defaultConfidentialityForKind,
  isConfidentialityLevel,
  mayErase,
  retentionForKind,
  type CanvasBoundary,
  type ConfidentialityLevel,
  type CreationObjectKind,
  type RetentionRule,
} from '@builderforce/creation-canvas-contract';

export type { CanvasBoundary, ConfidentialityLevel, RetentionRule };
export { BOUNDARY_CEILING, boundaryAdmits, mayErase, retentionForKind };

/**
 * The shape this module needs from a board object.
 *
 * Structural rather than the full node type so the API's share and Drive paths can pass
 * a stored row and the canvas can pass a React Flow node, without either converting.
 * Spec fields live flat on `data`, which is where `confidentiality` is authored.
 */
export interface ConfidentialityFields {
  kind: CreationObjectKind | string;
  title?: string;
  confidentiality?: unknown;
}

export interface ConfidentialityCandidate {
  id: string;
  data: ConfidentialityFields;
}

/**
 * The level a bare field bag is held at.
 *
 * The data-level primitive, because half the callers hold a node (`{ id, data }`) and
 * half hold the fields alone (an export row, a Drive payload). Both questions have ONE
 * implementation and it is this one.
 *
 * An explicitly authored level wins; anything else falls to the kind's default, which is
 * `internal` for most kinds, `restricted` for the ones where not thinking about it IS the
 * disclosure, and `public` for the two whose whole purpose is being published. An
 * unparseable value falls back to the kind default rather than to `public`, because a
 * typo must never be the thing that opens a boundary.
 */
export function fieldsConfidentiality(data: ConfidentialityFields): ConfidentialityLevel {
  if (isConfidentialityLevel(data.confidentiality)) return data.confidentiality;
  return defaultConfidentialityForKind(String(data.kind));
}

/** True when a bare field bag may cross this boundary. */
export function fieldsMayCross(data: ConfidentialityFields, boundary: CanvasBoundary): boolean {
  return boundaryAdmits(fieldsConfidentiality(data), boundary);
}

/** The level an object is actually held at. */
export function objectConfidentiality(object: ConfidentialityCandidate): ConfidentialityLevel {
  return fieldsConfidentiality(object.data);
}

/** True when this one object may cross this one boundary. */
export function objectMayCross(object: ConfidentialityCandidate, boundary: CanvasBoundary): boolean {
  return fieldsMayCross(object.data, boundary);
}

/** One object that was held back, with the level that held it. */
export interface WithheldObject {
  id: string;
  kind: string;
  title: string;
  level: ConfidentialityLevel;
}

export interface BoundaryPartition<T extends ConfidentialityCandidate> {
  /** Objects that may cross. Order preserved. */
  allowed: T[];
  /** Objects that may not, with enough identity to name them to the user. */
  withheld: WithheldObject[];
  /** The ceiling this boundary was judged against — for the explanatory notice. */
  ceiling: ConfidentialityLevel;
}

/**
 * Split a board for one boundary.
 *
 * The single entry point every caller uses. Returning both halves is deliberate: see the
 * module header on why a filter would have been the wrong signature.
 */
export function partitionForBoundary<T extends ConfidentialityCandidate>(
  objects: readonly T[],
  boundary: CanvasBoundary,
): BoundaryPartition<T> {
  const allowed: T[] = [];
  const withheld: WithheldObject[] = [];
  for (const object of objects) {
    const level = objectConfidentiality(object);
    if (boundaryAdmits(level, boundary)) {
      allowed.push(object);
    } else {
      withheld.push({
        id: object.id,
        kind: String(object.data.kind),
        title: object.data.title?.trim() || '(untitled)',
        level,
      });
    }
  }
  return { allowed, withheld, ceiling: BOUNDARY_CEILING[boundary] };
}

/**
 * The i18n key and count a surface needs to tell the user what was held back.
 *
 * Returns `null` when nothing was withheld so a caller can render nothing without
 * testing the array itself — which is the check that gets forgotten and produces
 * "0 objects were withheld".
 */
export function withheldNotice<T extends ConfidentialityCandidate>(
  partition: BoundaryPartition<T>,
): { count: number; titles: string[] } | null {
  if (partition.withheld.length === 0) return null;
  return {
    count: partition.withheld.length,
    // Capped: a notice that lists forty titles is not a notice, it is the board again.
    titles: partition.withheld.slice(0, 5).map((entry) => entry.title),
  };
}

/**
 * Whether an object may be erased today.
 *
 * The retention half of the same question, kept in this module so the erasure path and
 * the boundary paths cannot disagree about which kinds are special. `since` is whichever
 * event the kind's rule names — creation for hiring records, the end of the relationship
 * for employment records; `retentionForKind(kind).clock` says which, and the caller owns
 * the date because only the caller knows when a relationship ended.
 */
export function erasureDecision(
  kind: string,
  since: Date | string | null | undefined,
  now: Date = new Date(),
): { mayErase: boolean; rule: RetentionRule; daysElapsed: number; daysRemaining: number } {
  const rule = retentionForKind(kind);
  const start = since ? new Date(since) : null;
  const daysElapsed = start && !Number.isNaN(start.getTime())
    ? Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000))
    : 0;
  return {
    mayErase: mayErase(kind, daysElapsed),
    rule,
    daysElapsed,
    daysRemaining: Math.max(0, rule.minimumRetentionDays - daysElapsed),
  };
}
