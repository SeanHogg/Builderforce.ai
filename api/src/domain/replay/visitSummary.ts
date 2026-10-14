/**
 * The kept recording's row, as an incremental fold (PRD 33 §3.2 `replay_recordings`).
 *
 * Each KEPT chunk updates the row's counters, paths, active time, end marker and the
 * capped arrays filters, funnels and flow read (`routes`, `events`, `frustrations`,
 * `clicked`, `issue_fps`, `steps`). The Worker never re-reads earlier chunks:
 * `foldVisit(prev, chunk, now, siteId)` is the whole state machine, so a crash
 * between chunks leaves a row the next chunk can resume.
 *
 * `siteId` is needed for one thing — issue fingerprints are per site, and the row's
 * `issue_fps` must equal the fingerprints the rollups write.
 */

import {
  REPLAY_LIMITS,
  type ReplayChunk,
  type ReplayDeviceClass,
  type ReplayKeepReason,
} from '@builderforce/interaction-contract';
import { attributeRoutes, cap, eventNamesOf, isFrustrationKind, isGoalMark, issueOf } from './markWalk';

/** Distinct values kept per array column (`clicked` is ≤ 50 by the PRD). */
export const VISIT_ARRAY_CAP = 50;
/** Ordered route/event steps kept for funnels and flow. */
export const VISIT_STEPS_CAP = 60;

const PATH_MAX = 400;
const SELECTOR_MAX = 400;

export interface VisitRow {
  visitId: string;
  visitorId: string;
  startedAt: Date;
  lastEventAt: Date;
  endedAt: Date | null;
  durationMs: number;
  activeMs: number;
  entryPath: string;
  exitPath: string;
  pageCount: number;
  releaseKey: string;
  recorderVersion: string;
  deviceClass: ReplayDeviceClass;
  viewportW: number;
  viewportH: number;
  browser: string | null;
  os: string | null;
  referrerHost: string | null;
  clickCount: number;
  rageCount: number;
  deadCount: number;
  errorCount: number;
  quickbackCount: number;
  excessiveScrollCount: number;
  converted: boolean;
  keepReason: ReplayKeepReason;
  sampleWeight: number;
  variant: string | null;
  identifiedId: string | null;
  traits: Record<string, string> | null;
  chunkCount: number;
  routes: string[];
  events: string[];
  frustrations: string[];
  clicked: string[];
  issueFps: string[];
  steps: string[];
  tags: Record<string, string>;
}

/** Append distinct values, keeping the first `max`. */
function addDistinct(into: string[], values: Iterable<string>, max: number): string[] {
  const out = into.slice();
  const seen = new Set(out);
  for (const value of values) {
    if (out.length >= max) break;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Append steps in order, collapsing an immediate repeat, keeping the first `max`. */
function addSteps(into: string[], values: readonly string[], max: number): string[] {
  const out = into.slice();
  for (const value of values) {
    if (out.length >= max) break;
    if (out[out.length - 1] === value) continue;
    out.push(value);
  }
  return out;
}

/** Sticky tags: last write wins for a known key; a new key only while under the cap. */
function mergeTags(prev: Record<string, string>, next: Record<string, string> | undefined): Record<string, string> {
  if (!next) return prev;
  const out = { ...prev };
  for (const [key, value] of Object.entries(next)) {
    if (key in out || Object.keys(out).length < REPLAY_LIMITS.maxTagsPerVisit) out[key] = value;
  }
  return out;
}

function count(chunk: ReplayChunk, kind: string): number {
  let n = 0;
  for (const mark of chunk.marks) if (mark.kind === kind) n += 1;
  return n;
}

/**
 * Fold one kept chunk into the recording row. `now` is ingest time: `lastEventAt`
 * never runs past it, and a chunk with no marks still proves the visit was alive.
 */
export function foldVisit(prev: VisitRow | null, chunk: ReplayChunk, now: Date, siteId: string): VisitRow {
  const startedAt = prev?.startedAt ?? new Date(Math.min(chunk.startedAt, now.getTime()));
  const maxAt = chunk.marks.reduce((max, mark) => Math.max(max, mark.atMs), -1);
  const candidate = maxAt >= 0 ? startedAt.getTime() + maxAt : now.getTime();
  const floor = prev ? prev.lastEventAt.getTime() : startedAt.getTime();
  const lastEventAt = new Date(Math.max(floor, Math.min(candidate, now.getTime())));

  const { attributed, endRoute } = attributeRoutes(chunk.marks, prev?.exitPath ?? '');
  const pages = attributed.filter((a) => a.mark.kind === 'page').map((a) => a.route);

  const issueFps: string[] = [];
  const events: string[] = [];
  const steps: string[] = [];
  const clicked: string[] = [];
  const frustrations: string[] = [];
  let goal = false;
  for (const item of attributed) {
    const { mark, route } = item;
    const hit = issueOf(siteId, item);
    if (hit) issueFps.push(hit.fingerprint);
    if (isFrustrationKind(mark.kind)) frustrations.push(mark.kind);
    if ((mark.kind === 'click' || mark.kind === 'rage' || mark.kind === 'dead') && mark.key) {
      clicked.push(cap(mark.key, SELECTOR_MAX));
    }
    if (mark.kind === 'page') steps.push(`page:${route}`);
    for (const name of eventNamesOf(mark)) {
      events.push(name);
      steps.push(`event:${name}`);
    }
    if (isGoalMark(mark)) goal = true;
  }

  const identify = chunk.identify;
  return {
    visitId: prev?.visitId ?? chunk.visitId,
    visitorId: prev?.visitorId ?? chunk.visitorId,
    startedAt,
    lastEventAt,
    endedAt: prev?.endedAt ?? (chunk.end ? lastEventAt : null),
    durationMs: Math.max(0, lastEventAt.getTime() - startedAt.getTime()),
    activeMs: Math.max(prev?.activeMs ?? 0, Math.round(chunk.activeMs ?? 0)),
    entryPath: prev?.entryPath || cap(pages[0] ?? '', PATH_MAX),
    exitPath: cap(endRoute || prev?.exitPath || '', PATH_MAX),
    pageCount: (prev?.pageCount ?? 0) + pages.length,
    releaseKey: prev?.releaseKey || chunk.release,
    recorderVersion: chunk.recorderVersion || prev?.recorderVersion || '',
    deviceClass: prev?.deviceClass ?? chunk.device.class,
    viewportW: Math.round(chunk.device.w) || prev?.viewportW || 0,
    viewportH: Math.round(chunk.device.h) || prev?.viewportH || 0,
    browser: prev?.browser ?? chunk.browser ?? null,
    os: prev?.os ?? chunk.os ?? null,
    referrerHost: prev?.referrerHost ?? chunk.referrer ?? null,
    clickCount: (prev?.clickCount ?? 0) + count(chunk, 'click'),
    rageCount: (prev?.rageCount ?? 0) + count(chunk, 'rage'),
    deadCount: (prev?.deadCount ?? 0) + count(chunk, 'dead'),
    errorCount: (prev?.errorCount ?? 0) + count(chunk, 'error'),
    quickbackCount: (prev?.quickbackCount ?? 0) + count(chunk, 'quickback'),
    excessiveScrollCount: (prev?.excessiveScrollCount ?? 0) + count(chunk, 'excessive_scroll'),
    converted: (prev?.converted ?? false) || goal || chunk.keep === 'goal',
    // The FIRST reason a visit was kept is the one it is filed under.
    keepReason: prev?.keepReason ?? chunk.keep ?? 'sample',
    sampleWeight: prev?.sampleWeight ?? chunk.sampleWeight,
    variant: chunk.variant ?? prev?.variant ?? null,
    identifiedId: identify?.id ?? prev?.identifiedId ?? null,
    traits: identify?.traits ? { ...(prev?.traits ?? {}), ...identify.traits } : prev?.traits ?? null,
    chunkCount: (prev?.chunkCount ?? 0) + 1,
    routes: addDistinct(prev?.routes ?? [], pages, VISIT_ARRAY_CAP),
    events: addDistinct(prev?.events ?? [], events, VISIT_ARRAY_CAP),
    frustrations: addDistinct(prev?.frustrations ?? [], frustrations, VISIT_ARRAY_CAP),
    clicked: addDistinct(prev?.clicked ?? [], clicked, VISIT_ARRAY_CAP),
    issueFps: addDistinct(prev?.issueFps ?? [], issueFps, VISIT_ARRAY_CAP),
    steps: addSteps(prev?.steps ?? [], steps, VISIT_STEPS_CAP),
    tags: mergeTags(prev?.tags ?? {}, chunk.tags),
  };
}
