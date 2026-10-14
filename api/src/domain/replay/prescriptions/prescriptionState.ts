/**
 * A prescription's lifecycle, as pure functions (PRD 33 §5.1.4–5).
 *
 *   • `action_ref` packs what an action created — the ticket, the A/B test, the
 *     preview and live releases, the sequence — into the one column the action
 *     route owns (`t=<taskId>;x=<testId>;p=<preview>;l=<live>;s=<sequence>`).
 *   • `verdictFor` turns a measured delta into worked / no_effect / worse in the
 *     acceptance direction.
 *   • `nextActions` says which `REPLAY_PATHS.prescriptionAction` a card may call
 *     now — the human gates of D13 live here: a preview is published by a person,
 *     a test is started by a person, and Revert is offered only on `worse` after a
 *     published fix.
 *   • `prescriptionMatchesFilter` narrows the list by the filter bar's page and issue clauses.
 */

import type {
  ReplayFilter,
  ReplayPrescriptionActionKind,
  ReplayPrescriptionRouteAction,
  ReplayPrescriptionStatus,
} from '@builderforce/interaction-contract';

export interface PrescriptionRefs {
  taskId: number | null;
  testId: number | null;
  previewRelease: string | null;
  liveRelease: string | null;
  sequenceObjectId: string | null;
}

export const EMPTY_REFS: PrescriptionRefs = { taskId: null, testId: null, previewRelease: null, liveRelease: null, sequenceObjectId: null };

const REF_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
const ACTION_REF_MAX = 120;

export function decodeActionRef(raw: string | null | undefined): PrescriptionRefs {
  const refs: PrescriptionRefs = { ...EMPTY_REFS };
  if (!raw) return refs;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (!REF_TOKEN.test(value)) continue;
    if (key === 't' && /^\d+$/.test(value)) refs.taskId = Number(value);
    else if (key === 'x' && /^\d+$/.test(value)) refs.testId = Number(value);
    else if (key === 'p') refs.previewRelease = value;
    else if (key === 'l') refs.liveRelease = value;
    else if (key === 's') refs.sequenceObjectId = value;
  }
  return refs;
}

export function encodeActionRef(refs: PrescriptionRefs): string | null {
  const parts = [
    refs.taskId !== null ? `t=${refs.taskId}` : '',
    refs.testId !== null ? `x=${refs.testId}` : '',
    refs.previewRelease && REF_TOKEN.test(refs.previewRelease) ? `p=${refs.previewRelease}` : '',
    refs.liveRelease && REF_TOKEN.test(refs.liveRelease) ? `l=${refs.liveRelease}` : '',
    refs.sequenceObjectId && REF_TOKEN.test(refs.sequenceObjectId) ? `s=${refs.sequenceObjectId}` : '',
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const joined = parts.join(';');
  if (joined.length > ACTION_REF_MAX) throw new Error('action_ref would exceed its column');
  return joined;
}

/** A change smaller than this share of the baseline is no effect. */
export const VERDICT_MIN_RELATIVE_CHANGE = 0.05;

/**
 * The verdict of a measured change. `delta` = after − before. Relative to `before`
 * when there is a non-zero baseline, else absolute.
 */
export function verdictFor(
  delta: number,
  before: number | null,
  direction: 'up' | 'down',
  minRelative: number = VERDICT_MIN_RELATIVE_CHANGE,
): 'worked' | 'no_effect' | 'worse' {
  const improvement = direction === 'down' ? -delta : delta;
  const relative = before !== null && before !== 0 ? improvement / Math.abs(before) : improvement;
  if (relative >= minRelative) return 'worked';
  if (relative <= -minRelative) return 'worse';
  return 'no_effect';
}

export const TERMINAL_STATUSES: readonly ReplayPrescriptionStatus[] = ['worked', 'no_effect', 'worse', 'dismissed'];

export const isTerminalStatus = (status: string): boolean => (TERMINAL_STATUSES as readonly string[]).includes(status);

const ROUTE_ACTION_OF: Partial<Record<ReplayPrescriptionActionKind, ReplayPrescriptionRouteAction>> = {
  fix: 'fix',
  test: 'test',
  follow_up: 'follow-up',
  ticket: 'ticket',
  dismiss: 'dismiss',
};

/**
 * The §5.2 page actions open on a fix right now:
 *   copy-prompt        any open fix that has a page
 *   apply-page         an open fix on a page that has ≥ 1 accepted fix (itself, by default)
 *   apply-in-composer  a proposed fix on a page of a hosted canvas app
 */
function pageActions(input: NextActionsInput): ReplayPrescriptionRouteAction[] {
  if (!input.pagePath || isTerminalStatus(input.status)) return [];
  const out: ReplayPrescriptionRouteAction[] = ['copy-prompt'];
  if ((input.pageAcceptedFixes ?? 1) >= 1) out.push('apply-page');
  if (input.status === 'proposed' && input.hostedCanvas) out.push('apply-in-composer');
  return out;
}

export interface NextActionsInput {
  status: string;
  actionKind: string | null;
  refs: PrescriptionRefs;
  ruleActions: readonly ReplayPrescriptionActionKind[];
  /** The fix's page (§5.2 page actions need one). */
  pagePath?: string | null;
  /** The site is a Builderforce-hosted canvas app (`apply-in-composer`). */
  hostedCanvas?: boolean;
  /** Accepted (open) fixes on the page; defaults to 1 — the open fix itself. */
  pageAcceptedFixes?: number;
}

/** What a card may call now. */
export function nextActions(input: NextActionsInput): ReplayPrescriptionRouteAction[] {
  const { status, actionKind, refs } = input;
  if (status === 'proposed') {
    const offered = input.ruleActions
      .map((kind) => ROUTE_ACTION_OF[kind])
      .filter((a): a is ReplayPrescriptionRouteAction => !!a)
      // Test it splits live against a PREVIEW: it opens only after a fix built one.
      .filter((a) => a !== 'test');
    return [...new Set<ReplayPrescriptionRouteAction>([...offered, ...pageActions(input), 'dismiss'])];
  }
  const out: ReplayPrescriptionRouteAction[] = [];
  if (status === 'applied' && actionKind === 'fix' && refs.previewRelease) {
    out.push('publish-preview');
    if (input.ruleActions.includes('test')) out.push('test');
  }
  if (status === 'applied' && actionKind === 'test' && refs.testId !== null) out.push('start-test');
  // A test that proved the preview: a person still publishes it.
  if (status === 'worked' && actionKind === 'test' && refs.previewRelease && !refs.liveRelease) out.push('publish-preview');
  if (status === 'applied' && actionKind === 'follow_up') out.push('follow-up');
  // Revert republishes the release that was live before a PUBLISHED fix — never a hand-applied one.
  if (status === 'worse' && refs.liveRelease && refs.previewRelease && (actionKind === 'fix' || actionKind === 'test')) out.push('revert');
  out.push(...pageActions(input));
  if (!isTerminalStatus(status)) out.push('dismiss');
  return out;
}

const PATH_FIELDS = new Set(['visitedPath', 'entryPath', 'exitPath']);

function pathClauseMatches(op: string, value: unknown, path: string): boolean {
  const values = Array.isArray(value) ? value.map(String) : [String(value)];
  switch (op) {
    case 'eq': return values[0] === path;
    case 'neq': return values[0] !== path;
    case 'in': return values.includes(path);
    case 'contains': return path.includes(values[0] ?? '');
    case 'prefix': return path.startsWith(values[0] ?? '');
    default: return true;
  }
}

/**
 * A prescription passes the filter bar when its page passes every path clause and
 * its issue passes an `issue` clause. Clauses about a visit (device, browser, …)
 * do not describe a prescription and are ignored — never "no match".
 */
export function prescriptionMatchesFilter(
  item: { pagePath: string | null; fingerprint: string | null },
  filter: ReplayFilter | null | undefined,
): boolean {
  if (!filter) return true;
  for (const clause of filter.all) {
    if (PATH_FIELDS.has(clause.field)) {
      if (item.pagePath === null || !pathClauseMatches(clause.op, clause.value, item.pagePath)) return false;
    } else if (clause.field === 'issue') {
      if (item.fingerprint !== String(clause.value)) return false;
    }
  }
  return true;
}
