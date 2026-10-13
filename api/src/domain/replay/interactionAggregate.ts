/**
 * The exact rollups, as a pure fold over ONE chunk (PRD 33 §3.3 step 3, D15, D18).
 *
 * Every session's chunks — kept or not — fold here into ADDITIVE increments keyed by
 * route × day × release × device: route counts, the seq-0 breakdowns, heat cells,
 * vitals histograms, issue sessions and live presence. The ingest buffer sums them
 * and flushes `n = n + EXCLUDED.n`, so rows grow with routes and issues, never with
 * sessions, and the counts are exact over every session.
 *
 * Per-visit "count once" facts (a session, a conversion, a frustrated session, an
 * issue session) need memory of the visit across chunks. That memory is the
 * {@link VisitRollupState} the caller passes in and gets back: the kept recording's
 * row when there is one, else the ingest isolate's bounded visit cache.
 */

import {
  VITAL_BUCKETS,
  VITAL_METRICS,
  vitalBucket,
  type ReplayChunk,
  type ReplayDeviceClass,
  type VitalMetric,
} from '@builderforce/interaction-contract';
import { attributeRoutes, cap, isFrustrationKind, isGoalMark, issueOf } from './markWalk';

export const HEAT_KINDS = ['click', 'rage', 'dead', 'scroll'] as const;
export type HeatKind = (typeof HEAT_KINDS)[number];

export const BREAKDOWN_DIMS = ['country', 'device', 'browser', 'os', 'referrer', 'entry', 'exit'] as const;
export type BreakdownDim = (typeof BREAKDOWN_DIMS)[number];

const SELECTOR_MAX = 200;
const LABEL_MAX = 80;
const VALUE_MAX = 200;
const RELEASE_MAX = 64;
/** Issues remembered per visit for "count each issue once per session". */
export const VISIT_ISSUE_MEMORY = 100;

/** What the fold remembers about one visit between its chunks. */
export interface VisitRollupState {
  /** The route the visit was last on. */
  route: string;
  /** Cumulative active ms already attributed (the recorder reports a running total). */
  activeMs: number;
  converted: boolean;
  frustrated: boolean;
  /** Issue fingerprints already counted for this visit. */
  issueFps: string[];
}

export interface RollupContext {
  siteId: string;
  /** `YYYY-MM-DD`, UTC — the day the increments land on. */
  day: string;
  /** ISO country of the request (`cf.country`), when known. */
  country: string | null;
  /** The visit's state before this chunk; null for a visit not seen yet. */
  visit: VisitRollupState | null;
}

interface CellBase {
  releaseKey: string;
  route: string;
  deviceClass: ReplayDeviceClass;
}

export interface RouteIncrement extends CellBase {
  sessions: number;
  entries: number;
  exits: number;
  pageviews: number;
  newVisitors: number;
  conversions: number;
  frustrated: number;
  errors: number;
  activeMsSum: number;
  scrollDepthSum: number;
}

export interface BreakdownIncrement {
  dim: BreakdownDim;
  value: string;
  sessions: number;
}

export interface HeatIncrement extends CellBase {
  kind: HeatKind;
  selector: string;
  label: string;
  gx: number;
  gy: number;
  n: number;
}

export interface VitalIncrement extends CellBase {
  metric: VitalMetric;
  bucket: number;
  n: number;
}

export interface IssueIncrement {
  fingerprint: string;
  kind: string;
  route: string;
  subject: string;
  title: string;
  releaseKey: string;
  deviceClass: ReplayDeviceClass;
  sessions: number;
}

export interface LivePresence {
  visitId: string;
  route: string;
  deviceClass: ReplayDeviceClass;
  x: number | null;
  y: number | null;
}

export interface RollupCells {
  routes: RouteIncrement[];
  breakdowns: BreakdownIncrement[];
  heat: HeatIncrement[];
  vitals: VitalIncrement[];
  issues: IssueIncrement[];
  live: LivePresence;
  next: VisitRollupState;
}

function emptyRoute(base: CellBase): RouteIncrement {
  return {
    ...base,
    sessions: 0, entries: 0, exits: 0, pageviews: 0, newVisitors: 0,
    conversions: 0, frustrated: 0, errors: 0, activeMsSum: 0, scrollDepthSum: 0,
  };
}

function clampDecile(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(9, Math.max(0, Math.round(value)));
}

function isVitalMetric(key: string): key is VitalMetric {
  return (VITAL_METRICS as readonly string[]).includes(key);
}

/** Fold one parsed chunk into additive increments plus the visit's next state. */
export function rollupCells(chunk: ReplayChunk, ctx: RollupContext): RollupCells {
  const releaseKey = cap(chunk.release, RELEASE_MAX);
  const deviceClass = chunk.device.class;
  const prior: VisitRollupState = ctx.visit ?? {
    route: '', activeMs: 0, converted: false, frustrated: false, issueFps: [],
  };
  const { attributed, endRoute } = attributeRoutes(chunk.marks, prior.route);

  const routes = new Map<string, RouteIncrement>();
  const routeCell = (route: string): RouteIncrement => {
    let cell = routes.get(route);
    if (!cell) {
      cell = emptyRoute({ releaseKey, route, deviceClass });
      routes.set(route, cell);
    }
    return cell;
  };

  const firstPage = attributed.find((a) => a.mark.kind === 'page');
  const entryRoute = firstPage?.route ?? endRoute;
  const isFirstChunk = chunk.seq === 0 && ctx.visit === null;

  if (isFirstChunk) {
    const entry = routeCell(entryRoute);
    entry.sessions += 1;
    entry.entries += 1;
    if (chunk.newVisitor) entry.newVisitors += 1;
  }

  const heat = new Map<string, HeatIncrement>();
  const vitals = new Map<string, VitalIncrement>();
  const issues = new Map<string, IssueIncrement>();
  const seenIssues = new Set(prior.issueFps);
  let converted = prior.converted;
  let frustrated = prior.frustrated;
  let x: number | null = null;
  let y: number | null = null;

  const addHeat = (cell: Omit<HeatIncrement, 'n'>) => {
    const key = [cell.route, cell.kind, cell.selector, cell.label, cell.gx, cell.gy].join('\u001f');
    const found = heat.get(key);
    if (found) found.n += 1;
    else heat.set(key, { ...cell, n: 1 });
  };

  for (const item of attributed) {
    const { mark, route } = item;
    switch (mark.kind) {
      case 'page':
        routeCell(route).pageviews += 1;
        break;
      case 'error':
        routeCell(route).errors += 1;
        break;
      case 'scroll': {
        const decile = clampDecile(mark.value);
        routeCell(route).scrollDepthSum += decile;
        addHeat({ releaseKey, route, deviceClass, kind: 'scroll', selector: '', label: '', gx: 0, gy: decile });
        break;
      }
      case 'click':
      case 'rage':
      case 'dead':
        if (mark.gx !== undefined && mark.gy !== undefined) {
          addHeat({
            releaseKey, route, deviceClass, kind: mark.kind,
            selector: cap(mark.key, SELECTOR_MAX),
            label: cap(mark.label ?? '', LABEL_MAX),
            gx: mark.gx, gy: mark.gy,
          });
          x = mark.gx;
          y = mark.gy;
        }
        break;
      case 'vital':
        if (isVitalMetric(mark.key) && mark.value !== undefined && Number.isFinite(mark.value)) {
          const bucket = vitalBucket(VITAL_BUCKETS[mark.key], mark.value);
          const key = [route, mark.key, bucket].join('\u001f');
          const found = vitals.get(key);
          if (found) found.n += 1;
          else vitals.set(key, { releaseKey, route, deviceClass, metric: mark.key, bucket, n: 1 });
        }
        break;
      default:
        break;
    }

    if (!frustrated && isFrustrationKind(mark.kind)) {
      frustrated = true;
      routeCell(route).frustrated += 1;
    }
    if (!converted && isGoalMark(mark)) {
      converted = true;
      routeCell(route).conversions += 1;
    }

    const hit = issueOf(ctx.siteId, item);
    if (hit && !seenIssues.has(hit.fingerprint) && seenIssues.size < VISIT_ISSUE_MEMORY) {
      seenIssues.add(hit.fingerprint);
      issues.set(hit.fingerprint, { ...hit, releaseKey, deviceClass, sessions: 1 });
    }
  }

  // The recorder keeps a session for a goal it detected itself (`keep: 'goal'`);
  // that is a conversion even when the goal mark was in an earlier, unsent buffer.
  if (!converted && chunk.keep === 'goal') {
    converted = true;
    routeCell(endRoute).conversions += 1;
  }

  let activeMs = prior.activeMs;
  if (chunk.activeMs !== undefined && chunk.activeMs > prior.activeMs) {
    routeCell(endRoute).activeMsSum += Math.round(chunk.activeMs - prior.activeMs);
    activeMs = chunk.activeMs;
  }

  if (chunk.end) routeCell(endRoute).exits += 1;

  const breakdowns: BreakdownIncrement[] = [];
  const addDim = (dim: BreakdownDim, value: string | null | undefined) => {
    if (value) breakdowns.push({ dim, value: cap(value, VALUE_MAX), sessions: 1 });
  };
  if (isFirstChunk) {
    addDim('country', ctx.country);
    addDim('device', deviceClass);
    addDim('browser', chunk.browser);
    addDim('os', chunk.os);
    addDim('referrer', chunk.referrer);
    addDim('entry', entryRoute);
  }
  if (chunk.end) addDim('exit', endRoute);

  return {
    routes: [...routes.values()],
    breakdowns,
    heat: [...heat.values()],
    vitals: [...vitals.values()],
    issues: [...issues.values()],
    live: { visitId: chunk.visitId, route: endRoute, deviceClass, x, y },
    next: {
      route: endRoute,
      activeMs,
      converted,
      frustrated,
      issueFps: [...seenIssues],
    },
  };
}
