/**
 * The shapes a prescription rule reads and writes (PRD 33 §5.1, D13) — pure.
 *
 * A rule never touches a database: the application builds ONE `SiteAggregates`
 * per site through the cached Insights reads (`prescriptionAggregates.ts`) and
 * every rule in `PRESCRIPTION_RULES` is a function over it. What a rule returns
 * is a deterministic `Finding` — the AI only phrases findings that already exist.
 */

import type {
  ReplayPrescriptionActionKind,
  ReplayPrescriptionArea,
} from '@builderforce/interaction-contract';
import type { PageFacts } from './pageFacts';

/** A conversion cohort: visits and the conversions among them (≈ when from kept recordings). */
export interface Cohort {
  visits: number;
  conversions: number;
}

/**
 * The two cohorts an impact compares: visits the finding touched (`with`) and the
 * comparable visits it did not (`without`). `estimated` when weighted kept recordings.
 */
export interface ImpactCohorts {
  with: Cohort;
  without: Cohort;
  estimated: boolean;
}

/** One issue group with its window stats (exact) and, when kept recordings allow, cohorts. */
export interface IssueAggregate {
  id: string;
  fingerprint: string;
  kind: string;
  route: string;
  subject: string;
  title: string;
  status: string;
  /** Sessions with the issue in the window (exact). */
  sessions: number;
  /** Share of the route's sessions, 0..1. */
  share: number;
  /** Sessions on the route in the window (exact). */
  routeSessions: number;
  /** The issue's representative recordings, best first. */
  recordingIds: string[];
  /** Converting vs not among kept recordings with and without the issue on its route. */
  cohorts: ImpactCohorts | null;
}

/** One element on one route (exact heat counts). */
export interface ElementAggregate {
  route: string;
  selector: string;
  label: string | null;
  clicks: number;
  rage: number;
  dead: number;
  /** Interaction-weighted median grid row, null without cells. */
  medianGy: number | null;
}

/** Scroll reach of one route: `reach[i]` = share of page views reaching decile i. */
export interface ScrollAggregate {
  route: string;
  sessions: number;
  reach: number[];
}

/** One funnel step's drop-off, with the error issues seen among a sample of the drops. */
export interface FunnelStepAggregate {
  funnelId: string;
  funnelName: string;
  ord: number;
  label: string;
  /** Visits that reached the previous step (≈). */
  prevVisits: number;
  /** Visits that reached this step (≈). */
  visits: number;
  /** Dropped recordings that were read for errors. */
  droppedSampled: number;
  /** Error issues among the sampled drops: how many of them carried each. */
  dropErrors: Array<{ issueId: string; fingerprint: string; subject: string; route: string; drops: number; recordingIds: string[] }>;
}

/** Sessions and conversions of one value of a dimension (exact, from the route rollup). */
export interface SplitAggregate {
  value: string;
  sessions: number;
  conversions: number;
}

/** A release, newest first, with its exact sessions and conversions. */
export interface ReleaseAggregate {
  releaseKey: string;
  label: string | null;
  firstSeenAt: string;
  sessions: number;
  conversions: number;
}

/**
 * Identifiable visitors (the site's `identify` on) who reached a sales moment and
 * did not convert. Identities are NOT here — only counts and recording ids; the
 * one identity resolver is `resolveKnownContacts`.
 */
export interface KnownCohortAggregate {
  kind: 'pricing' | 'checkout';
  route: string;
  identifiedVisitors: number;
  convertedVisitors: number;
  recordingIds: string[];
}

/** A graded proof of this site's project. */
export interface ProofAggregate {
  realizationId: string;
  title: string;
  verdict: 'met' | 'missed';
  metricLabel: string | null;
  metricValue: number | null;
  target: number | null;
}

/** A cited pattern across a segment of visits (from the cached segment summary). */
export interface CitedPatternAggregate {
  text: string;
  examples: Array<{ recordingId: string; atMs: number }>;
}

/** Everything a rule may read about one site, over one window. */
export interface SiteAggregates {
  siteId: string;
  days: number;
  /** Rows of the heat lattice (`GRID`). */
  grid: number;
  site: { sessions: number; conversions: number };
  routes: Array<{ route: string; sessions: number; pageviews: number }>;
  issues: IssueAggregate[];
  elements: ElementAggregate[];
  scroll: ScrollAggregate[];
  funnelSteps: FunnelStepAggregate[];
  devices: SplitAggregate[];
  releases: ReleaseAggregate[];
  knownCohorts: KnownCohortAggregate[];
  proofs: ProofAggregate[];
  patterns: CitedPatternAggregate[];
  /** S4f: the key pages' captures, field vitals, behaviour and search facts (§5.2). */
  pages?: PageFacts[];
}

/** What a rule found: deterministic, cited by recording, with its own cohorts. */
export interface Finding {
  ruleId: string;
  area: ReplayPrescriptionArea;
  /** Stable identity of WHAT the finding is about, unique per (site, rule). */
  subjectKey: string;
  pagePath: string | null;
  /** Title params, rendered by the client from `insights.prescription.<ruleId>`. */
  params: Record<string, string | number>;
  evidence: Array<{ recordingId: string; atMs: number }>;
  /** The issue group this finding is about, when there is one. */
  issueId: string | null;
  fingerprint: string | null;
  /** The element, for the element map and the drafted change (selector + label only). */
  selector: string | null;
  label: string | null;
  /** Visits the finding touched in the window. */
  affected: number;
  cohorts: ImpactCohorts | null;
  /** S4f: the page capture the finding was read from. */
  captureId?: string | null;
  /** What the impact counts when it is not conversions (SEO rules count `clicks`). */
  impactUnit?: string;
}

export interface PrescriptionAcceptance {
  metric: string;
  direction: 'up' | 'down';
  minVisits: number;
}

/** One rule, as data. */
export interface PrescriptionRule {
  id: string;
  area: ReplayPrescriptionArea;
  effort: 1 | 2 | 3;
  /** The actions a person may take on a finding of this rule (dismiss is always offered). */
  actions: readonly ReplayPrescriptionActionKind[];
  thresholds: Readonly<Record<string, number>>;
  acceptance: PrescriptionAcceptance;
  detect(aggregates: SiteAggregates): Finding[];
}
