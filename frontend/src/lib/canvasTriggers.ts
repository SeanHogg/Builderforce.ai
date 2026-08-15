/**
 * The canvas side of trigger evaluation.
 *
 * ── WHERE THE ENGINE WENT, AND WHY ──────────────────────────────────────────────
 * The comparison itself used to live here, and that placement was the reason the
 * feature only half existed: a trigger evaluated ONLY when a person opened the board and
 * the model chose to call `canvas_evaluate_triggers`, so "the board warns you before the
 * contract auto-renews" was true exactly when somebody was already looking.
 *
 * It now lives in `@builderforce/creation-canvas-contract/triggers`, which the API
 * aliases too, so the nightly sweep and the tool run the SAME comparison. Two
 * implementations of one threshold is how a board comes to report armed on screen and
 * breached in a digest, with no way to tell which lied.
 *
 * ── WHAT IS LEFT HERE ───────────────────────────────────────────────────────────
 * The half that needs the frontend's spec registry: turning canvas nodes into the
 * engine's minimal board shape, and re-exporting the engine so existing importers keep
 * one import site. `specDeadlineFields()` is what makes a deadline binding resolve from
 * the DECLARATION rather than from a map somebody maintains by hand — see
 * `SpecField.deadline`.
 */

import {
  evaluateBoardTriggers,
  type ResolvedTrigger,
  type TriggerBoardObject,
} from '@builderforce/creation-canvas-contract';
import { specDeadlineFields } from './specObjects';

export {
  DATE_COMPARATORS,
  DEADLINE_FIELD_NAMES,
  TRIGGER_COMPARATORS,
  dateValue,
  daysUntil,
  evaluateBoardTriggers,
  evaluateTrigger,
  isDateComparator,
  numericValue,
  resolveDeadlineField,
} from '@builderforce/creation-canvas-contract';
export type {
  ResolvedTrigger,
  TriggerBoardObject,
  TriggerComparator,
  TriggerEvaluation,
  TriggerInput,
  TriggerState,
} from '@builderforce/creation-canvas-contract';

/** The shape a canvas node exposes. Structural rather than an import of the canvas's own
 *  node type, so this module does not depend on the component tree. */
export interface CanvasTriggerNode {
  id: string;
  data: { kind: string; title: string } & Record<string, unknown>;
}

/**
 * Evaluate every trigger on a set of canvas nodes.
 *
 * The `data.kind`/`data.title` unwrap is the only thing the canvas needs that the sweep
 * does not — a saved row carries kind and title as columns, a node carries them inside
 * `data` — so it is the whole of this adapter.
 */
export function evaluateCanvasTriggers(
  nodes: readonly CanvasTriggerNode[],
  nowMs: number,
  options?: { onlyTriggerId?: string },
): ResolvedTrigger[] {
  const board: TriggerBoardObject[] = nodes.map((node) => ({
    id: node.id,
    kind: String(node.data.kind ?? ''),
    title: String(node.data.title ?? ''),
    data: node.data,
  }));
  return evaluateBoardTriggers(board, nowMs, options);
}

/**
 * A human-readable account of what a trigger could not do.
 *
 * Here rather than at each call site because the same sentence is owed in three places —
 * the tool result, the card badge and the sweep's digest line — and an `unbound` a reader
 * cannot act on is the same silence the object exists to break. The deadline reasons name
 * the FIELDS the watched kind actually declares, which is the difference between "no
 * deadline" and "this contract has no renewsAt set".
 */
export function triggerUnboundHint(resolved: ResolvedTrigger): string | null {
  const { reason } = resolved.evaluation;
  if (reason === 'no-metric') {
    return resolved.triggerTitle
      ? `Nothing on this board is titled like "${resolved.triggerTitle}"'s \`watches\` value, so there is nothing to compare against.`
      : 'This trigger names no object to watch.';
  }
  if (reason === 'no-deadline-field') {
    const fields = resolved.watchedKind ? specDeadlineFields(resolved.watchedKind) : [];
    return fields.length
      ? `"${resolved.watchedTitle}" carries no deadline: set ${fields.map((name) => `\`${name}\``).join(' or ')} on it.`
      : `"${resolved.watchedTitle}" is a ${resolved.watchedKind ?? 'kind'}, which carries no deadline field — watch a contract, invoice, bill, obligation, policy, offer or funding round instead.`;
  }
  if (reason === 'deadline-not-a-date') {
    return `"${resolved.watchedTitle}"'s \`${resolved.deadlineField}\` is not a date. Write it as ISO (2026-09-30).`;
  }
  if (reason === 'metric-has-no-value') return `"${resolved.watchedTitle}" has no value yet — refresh it first.`;
  if (reason === 'no-threshold') return 'This trigger has no threshold to compare against.';
  return null;
}
