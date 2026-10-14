/**
 * Walking a chunk's marks — the shared reading both folds make (PRD 33 §3.3).
 *
 * The recorder attaches a route to `page`, `quickback`, `excessive_scroll` and
 * `scroll` marks only; a click, an error or a vital belongs to whatever page the
 * visitor was on when it happened. {@link attributeRoutes} is the ONE place that
 * answer is decided, so the recording row (`visitSummary`) and the exact rollups
 * (`interactionAggregate`) cannot disagree about which page a rage click was on.
 *
 * Issue identity is decided here too: an issue is (route, kind, subject), where the
 * subject is the element for rage/dead clicks, the error fingerprint for errors and
 * the route itself for quick backs and excessive scrolling.
 */

import {
  GOAL_SMART_EVENTS,
  issueFingerprint,
  routeTemplate,
  smartEventsForMark,
  type ReplayMark,
} from '@builderforce/interaction-contract';

/** Longest route a rollup key carries (the `route` columns are varchar(200)). */
export const ROUTE_MAX = 200;
/** Longest issue subject (`replay_issues.subject`). */
export const SUBJECT_MAX = 400;

/** The mark kinds that open an issue group. */
export const ISSUE_MARK_KINDS = ['rage', 'dead', 'error', 'quickback', 'excessive_scroll'] as const;
export type IssueMarkKind = (typeof ISSUE_MARK_KINDS)[number];

/** Frustration kinds (the `frustrations` array and the `frustrated` counter). */
const FRUSTRATION_KINDS: ReadonlySet<string> = new Set(ISSUE_MARK_KINDS);

/** Marks that carry their own route in `key`. */
const ROUTED_KINDS: ReadonlySet<string> = new Set(['page', 'quickback', 'excessive_scroll', 'scroll']);

export function cap(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/** A route as rollups store it: templated (idempotent on a template) and capped. */
export function rollupRoute(path: string): string {
  if (!path) return '';
  return cap(routeTemplate(path), ROUTE_MAX);
}

export interface AttributedMark {
  mark: ReplayMark;
  /** The route the visitor was on when the mark happened ('' when never known). */
  route: string;
}

/**
 * Attribute every mark to a route, in time order. `startRoute` is the route the
 * visit was on before this chunk (the recording's exit path, or the ingest buffer's
 * memory of the visit). Returns the route the chunk ends on.
 */
export function attributeRoutes(
  marks: readonly ReplayMark[],
  startRoute: string,
): { attributed: AttributedMark[]; endRoute: string } {
  const ordered = marks.map((mark, index) => ({ mark, index }))
    .sort((a, b) => a.mark.atMs - b.mark.atMs || a.index - b.index);
  let current = startRoute;
  const attributed: AttributedMark[] = [];
  for (const { mark } of ordered) {
    let route = current;
    if (ROUTED_KINDS.has(mark.kind) && mark.key) {
      route = rollupRoute(mark.key);
      if (mark.kind === 'page') current = route;
    }
    attributed.push({ mark, route });
  }
  return { attributed, endRoute: current };
}

export function isFrustrationKind(kind: string): boolean {
  return FRUSTRATION_KINDS.has(kind);
}

export function isIssueKind(kind: string): kind is IssueMarkKind {
  return FRUSTRATION_KINDS.has(kind);
}

/** What an issue of this mark is ABOUT: the element, the error, or the page. */
export function issueSubject(mark: ReplayMark, route: string): string {
  if (mark.kind === 'quickback' || mark.kind === 'excessive_scroll') return cap(route, SUBJECT_MAX);
  return cap(mark.key, SUBJECT_MAX);
}

const TITLE_MAX = 240;

const TITLE_PREFIX: Readonly<Record<IssueMarkKind, string>> = {
  rage: 'Rage clicks on',
  dead: 'Dead clicks on',
  error: 'JS error:',
  quickback: 'Quick backs from',
  excessive_scroll: 'Excessive scrolling on',
};

/**
 * A plain, stable title derived from kind + subject. It is data for search and the
 * read API's default label; the Insights UI renders its own translated phrasing from
 * `kind` and `subject`, so this string is never shown in place of a translation.
 */
export function issueTitle(kind: IssueMarkKind, subject: string, label?: string): string {
  const what = (label && label.trim()) || subject || '/';
  return cap(`${TITLE_PREFIX[kind]} ${what}`, TITLE_MAX);
}

export interface IssueHit {
  fingerprint: string;
  kind: IssueMarkKind;
  route: string;
  subject: string;
  title: string;
}

/** The issue a mark belongs to, or null for a mark that opens none. */
export function issueOf(siteId: string, attributed: AttributedMark): IssueHit | null {
  const { mark, route } = attributed;
  if (!isIssueKind(mark.kind)) return null;
  const subject = issueSubject(mark, route);
  return {
    fingerprint: issueFingerprint({ siteId, route, kind: mark.kind, subject }),
    kind: mark.kind,
    route,
    subject,
    title: issueTitle(mark.kind, subject, mark.label),
  };
}

/** Smart-event names a mark names: the custom event itself, or the built-ins it matches. */
export function eventNamesOf(mark: ReplayMark): string[] {
  if (mark.kind === 'event') return mark.key ? [mark.key] : [];
  if (mark.kind !== 'page' && mark.kind !== 'click') return [];
  return smartEventsForMark(mark);
}

const GOALS: ReadonlySet<string> = new Set(GOAL_SMART_EVENTS);

/** Whether this mark is a goal (a built-in goal smart event). */
export function isGoalMark(mark: ReplayMark): boolean {
  if (mark.kind !== 'page' && mark.kind !== 'click') return false;
  return smartEventsForMark(mark).some((name) => GOALS.has(name));
}
