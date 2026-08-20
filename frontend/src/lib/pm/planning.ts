import type { PlanVerdict } from '@/lib/builderforceApi';

/**
 * The three planning facts every dated surface has to render the SAME way.
 *
 * They were each being decided per-component before, which is how the board, the
 * ticket drawer and the planning spine ended up able to disagree about the same
 * Epic. Pure, presentation-free helpers: each returns a descriptor with a
 * translation KEY, never a translated string, so the caller keeps next-intl and
 * this file stays testable and locale-free.
 */

// ── 1. Which planner produced an Epic's children ─────────────────────────────

/** 'llm' | 'heuristic' | 'manual' as stored on `tasks.decomposition_source`. */
export type DecompositionSource = 'llm' | 'heuristic' | 'manual';

export interface DecompositionSourceBadge {
  source: DecompositionSource;
  /** Key under the `planning` namespace. */
  labelKey: string;
  titleKey: string;
  /** `warn` is the DEGRADED fallback — the model was unavailable, not "the AI is bad". */
  tone: 'neutral' | 'accent' | 'warn';
}

export function decompositionSourceBadge(source: string | null | undefined): DecompositionSourceBadge | null {
  if (source === 'llm') {
    return { source, labelKey: 'source.llm', titleKey: 'source.llmTitle', tone: 'accent' };
  }
  if (source === 'heuristic') {
    // The one that matters: no model answered, so the plan carries no estimates and
    // no sequence. Marked as a warning so it reads as a degradation, not a choice.
    return { source, labelKey: 'source.heuristic', titleKey: 'source.heuristicTitle', tone: 'warn' };
  }
  if (source === 'manual') {
    return { source, labelKey: 'source.manual', titleKey: 'source.manualTitle', tone: 'neutral' };
  }
  return null;
}

// ── 2. What the planner concluded about a plan ───────────────────────────────

export interface PlanWarning {
  kind: 'does-not-fit' | 'cyclic';
  /** Key under the `planning` namespace; takes a `count` param where relevant. */
  labelKey: string;
  titleKey: string;
  count: number;
  tone: 'warn' | 'danger';
}

/**
 * The actionable warnings in a verdict, most severe first.
 *
 * A dependency CYCLE outranks a misfit: a plan that does not fit is a date problem
 * a PM can negotiate, while a cycle means the ordering itself is a guess and the
 * dates below it mean nothing. Capacity deferral is deliberately NOT a warning —
 * the plan still lands inside its window, one person is simply the constraint, and
 * flagging it would train people to ignore the two that matter.
 */
export function planWarnings(verdict: PlanVerdict | null | undefined): PlanWarning[] {
  if (!verdict) return [];
  const out: PlanWarning[] = [];
  if (verdict.cyclic.length > 0) {
    out.push({
      kind: 'cyclic',
      labelKey: 'warning.cyclic',
      titleKey: 'warning.cyclicTitle',
      count: verdict.cyclic.length,
      tone: 'danger',
    });
  }
  if (verdict.compressed || verdict.overruns.length > 0) {
    out.push({
      kind: 'does-not-fit',
      labelKey: 'warning.doesNotFit',
      titleKey: verdict.compressed ? 'warning.compressedTitle' : 'warning.overrunTitle',
      count: verdict.overruns.length,
      tone: 'warn',
    });
  }
  return out;
}

// ── 3. "not yet scoped" vs "no dates" ────────────────────────────────────────

/** The kinds that are planning CONTAINERS rather than units of work. */
const CONTAINER_KINDS = new Set(['portfolio', 'objective', 'initiative', 'epic']);

/**
 * How a row with no window should READ.
 *
 * `not-yet-scoped` is reserved for a container nobody has dated and that has
 * nothing inside it to infer a window from — a freshly created objective is not
 * the same thing as a ticket somebody forgot to date, and rendering them
 * identically told the reader the wrong thing.
 *
 * `derived` means the dates came from the descendants rather than a commitment.
 */
export type WindowState = 'scoped' | 'derived' | 'not-yet-scoped' | 'undated';

export function windowState(node: {
  kind?: string | null;
  startDate: string | null;
  endDate: string | null;
  datesDerived?: boolean;
  notYetScoped?: boolean;
}): WindowState {
  if (node.startDate != null || node.endDate != null) {
    return node.datesDerived ? 'derived' : 'scoped';
  }
  // Trust the server's flag when the row carries one (the spine decides it once, for
  // every surface); otherwise apply the same rule locally, so a row that is not a
  // spine node — an objective off the OKR rollup, say — still answers consistently.
  const isContainer = node.notYetScoped ?? (node.kind != null && CONTAINER_KINDS.has(node.kind));
  return isContainer ? 'not-yet-scoped' : 'undated';
}

/** The `planning` translation key for a window state that has no dates to show. */
export function windowStateLabelKey(state: WindowState): string | null {
  if (state === 'not-yet-scoped') return 'notYetScoped';
  if (state === 'undated') return 'undated';
  return null;
}
