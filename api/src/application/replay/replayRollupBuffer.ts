/**
 * The per-isolate rollup buffer — every session's chunks summed in memory and
 * flushed as ADDITIVE upserts (PRD 33 D18 (1), §3.3 step 3).
 *
 * The shape is `ide/siteTraffic.ts`'s, for the same two reasons: ingest is a hot
 * public path, and a write per chunk would put Postgres latency on every beacon and
 * dominate the bill. So increments accumulate here, keyed by their grain, and one
 * flush writes `n = n + EXCLUDED.n` per table. Addition commutes, so concurrent
 * isolates flushing the same cell sum correctly.
 *
 * THE HONEST LIMITATION, stated where it is decided: an isolate evicted between
 * flushes loses at most one batch, and the per-visit memory ("this session was
 * already counted") is per isolate and bounded. The memory is only consulted for
 * a visit's LATER chunks — a session is counted on its seq-0 chunk regardless —
 * so the loss is a missed dedupe, never a missed session.
 *
 * Also buffered: release first/last sightings and live presence, so neither costs a
 * write per chunk.
 */

import type {
  BreakdownIncrement,
  HeatIncrement,
  IssueIncrement,
  RollupCells,
  RouteIncrement,
  VisitRollupState,
  VitalIncrement,
} from '../../domain/replay/interactionAggregate';

export interface SiteRef {
  siteId: string;
  tenantId: number;
}

export type Owned<T> = T & SiteRef & { day: string };

export interface PendingIssue extends SiteRef {
  fingerprint: string;
  kind: string;
  route: string;
  subject: string;
  title: string;
  firstRelease: string;
  lastRelease: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** `day|release|device` → sessions. */
  daily: Map<string, { day: string; releaseKey: string; deviceClass: string; sessions: number }>;
}

export interface PendingLive extends SiteRef {
  visitId: string;
  route: string;
  deviceClass: string;
  x: number | null;
  y: number | null;
  recordingId: string | null;
  lastSeenAt: Date;
}

export type ReleaseSource = 'explicit' | 'hosted' | 'fingerprint';

export interface PendingRelease extends SiteRef {
  releaseKey: string;
  source: ReleaseSource;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** One drained batch, ready to flush. */
export interface ReplayRollupBatch {
  routes: Array<Owned<RouteIncrement>>;
  breakdowns: Array<Owned<BreakdownIncrement>>;
  heat: Array<Owned<HeatIncrement>>;
  vitals: Array<Owned<VitalIncrement>>;
  issues: PendingIssue[];
  live: PendingLive[];
  releases: PendingRelease[];
}

export interface RollupBufferOptions {
  /** Flush once this many cells are pending. */
  maxPending?: number;
  /** Flush when the oldest pending cell is this old (ms). */
  maxAgeMs?: number;
  /** Visits remembered for count-once facts (oldest forgotten first). */
  maxVisits?: number;
  now?: () => number;
}

const ROUTE_SUM_FIELDS = [
  'sessions', 'entries', 'exits', 'pageviews', 'newVisitors',
  'conversions', 'frustrated', 'errors', 'activeMsSum', 'scrollDepthSum',
] as const;

const k = (...parts: Array<string | number>) => parts.join('\u001f');

export class ReplayRollupBuffer {
  private routes = new Map<string, Owned<RouteIncrement>>();
  private breakdowns = new Map<string, Owned<BreakdownIncrement>>();
  private heat = new Map<string, Owned<HeatIncrement>>();
  private vitals = new Map<string, Owned<VitalIncrement>>();
  private issues = new Map<string, PendingIssue>();
  private live = new Map<string, PendingLive>();
  private releases = new Map<string, PendingRelease>();
  private visits = new Map<string, VisitRollupState>();
  private oldestAt: number | null = null;
  private readonly maxPending: number;
  private readonly maxAgeMs: number;
  private readonly maxVisits: number;
  private readonly now: () => number;

  constructor(opts: RollupBufferOptions = {}) {
    this.maxPending = opts.maxPending ?? 400;
    this.maxAgeMs = opts.maxAgeMs ?? 10_000;
    this.maxVisits = opts.maxVisits ?? 20_000;
    this.now = opts.now ?? Date.now;
  }

  get pendingCount(): number {
    return this.routes.size + this.breakdowns.size + this.heat.size + this.vitals.size
      + this.issues.size + this.live.size + this.releases.size;
  }

  /** What this isolate remembers about a visit, or null. */
  visit(siteId: string, visitId: string): VisitRollupState | null {
    return this.visits.get(k(siteId, visitId)) ?? null;
  }

  private remember(siteId: string, visitId: string, state: VisitRollupState): void {
    const key = k(siteId, visitId);
    this.visits.delete(key); // re-insert = most recent
    this.visits.set(key, state);
    while (this.visits.size > this.maxVisits) {
      const oldest = this.visits.keys().next().value;
      if (oldest === undefined) break;
      this.visits.delete(oldest);
    }
  }

  private touch(): void {
    if (this.oldestAt === null) this.oldestAt = this.now();
  }

  /** Merge one chunk's increments. */
  add(site: SiteRef, day: string, cells: RollupCells, opts: { recordingId: string | null; at: Date }): void {
    const own = { siteId: site.siteId, tenantId: site.tenantId, day };
    for (const cell of cells.routes) {
      const key = k(site.siteId, day, cell.releaseKey, cell.route, cell.deviceClass);
      const found = this.routes.get(key);
      if (!found) this.routes.set(key, { ...cell, ...own });
      else for (const field of ROUTE_SUM_FIELDS) found[field] += cell[field];
    }
    for (const cell of cells.breakdowns) {
      const key = k(site.siteId, day, cell.dim, cell.value);
      const found = this.breakdowns.get(key);
      if (found) found.sessions += cell.sessions;
      else this.breakdowns.set(key, { ...cell, ...own });
    }
    for (const cell of cells.heat) {
      const key = k(site.siteId, day, cell.releaseKey, cell.route, cell.deviceClass, cell.kind, cell.selector, cell.label, cell.gx, cell.gy);
      const found = this.heat.get(key);
      if (found) found.n += cell.n;
      else this.heat.set(key, { ...cell, ...own });
    }
    for (const cell of cells.vitals) {
      const key = k(site.siteId, day, cell.releaseKey, cell.route, cell.deviceClass, cell.metric, cell.bucket);
      const found = this.vitals.get(key);
      if (found) found.n += cell.n;
      else this.vitals.set(key, { ...cell, ...own });
    }
    for (const issue of cells.issues) this.addIssue(site, day, issue, opts.at);

    const liveKey = k(site.siteId, cells.live.visitId);
    const prior = this.live.get(liveKey);
    this.live.set(liveKey, {
      ...site,
      visitId: cells.live.visitId,
      route: cells.live.route,
      deviceClass: cells.live.deviceClass,
      x: cells.live.x ?? prior?.x ?? null,
      y: cells.live.y ?? prior?.y ?? null,
      recordingId: opts.recordingId ?? prior?.recordingId ?? null,
      lastSeenAt: opts.at,
    });

    this.remember(site.siteId, cells.live.visitId, cells.next);
    this.touch();
  }

  private addIssue(site: SiteRef, day: string, issue: IssueIncrement, at: Date): void {
    const key = k(site.siteId, issue.fingerprint);
    let pending = this.issues.get(key);
    if (!pending) {
      pending = {
        ...site,
        fingerprint: issue.fingerprint,
        kind: issue.kind,
        route: issue.route,
        subject: issue.subject,
        title: issue.title,
        firstRelease: issue.releaseKey,
        lastRelease: issue.releaseKey,
        firstSeenAt: at,
        lastSeenAt: at,
        daily: new Map(),
      };
      this.issues.set(key, pending);
    }
    pending.lastRelease = issue.releaseKey;
    pending.lastSeenAt = at;
    const dailyKey = k(day, issue.releaseKey, issue.deviceClass);
    const daily = pending.daily.get(dailyKey);
    if (daily) daily.sessions += issue.sessions;
    else pending.daily.set(dailyKey, { day, releaseKey: issue.releaseKey, deviceClass: issue.deviceClass, sessions: issue.sessions });
  }

  /** Record a release sighting (first/last seen). An empty key is not a release. */
  noteRelease(site: SiteRef, releaseKey: string, source: ReleaseSource, at: Date): void {
    if (!releaseKey) return;
    const key = k(site.siteId, releaseKey);
    const found = this.releases.get(key);
    if (found) found.lastSeenAt = at;
    else this.releases.set(key, { ...site, releaseKey, source, firstSeenAt: at, lastSeenAt: at });
    this.touch();
  }

  shouldFlush(): boolean {
    if (this.pendingCount >= this.maxPending) return true;
    return this.oldestAt !== null && this.now() - this.oldestAt >= this.maxAgeMs;
  }

  /** Remove and return everything pending. The visit memory is KEPT across drains. */
  drain(): ReplayRollupBatch {
    const batch: ReplayRollupBatch = {
      routes: [...this.routes.values()],
      breakdowns: [...this.breakdowns.values()],
      heat: [...this.heat.values()],
      vitals: [...this.vitals.values()],
      issues: [...this.issues.values()],
      live: [...this.live.values()],
      releases: [...this.releases.values()],
    };
    this.routes.clear();
    this.breakdowns.clear();
    this.heat.clear();
    this.vitals.clear();
    this.issues.clear();
    this.live.clear();
    this.releases.clear();
    this.oldestAt = null;
    return batch;
  }
}

let shared: ReplayRollupBuffer | null = null;

/** The isolate's buffer, fed by every ingest. */
export function sharedReplayRollupBuffer(): ReplayRollupBuffer {
  if (!shared) shared = new ReplayRollupBuffer();
  return shared;
}

/** TEST-ONLY: start from an empty buffer. */
export function __resetReplayRollupBufferForTests(): void {
  shared = null;
}
