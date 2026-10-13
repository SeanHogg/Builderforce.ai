/**
 * The page score (PRD 33 §5.2 "Measure") — pure, per capture.
 *
 * Five components, each 0..100, null when there is nothing to score it on:
 *   conversion     the page's conversion against the site's (the site average = 50)
 *   frustration    the share of the page's sessions with no frustration
 *   seo            the share of the on-page SEO checks the capture passes
 *   performance    the Core Web Vitals pass rate — field p75 when the page has it,
 *                  else the runner's lab load (TBT stands in for INP)
 *   accessibility  100 less a bounded penalty per contrast failure, small tap
 *                  target, missing label, missing alt text and focus-order fight
 * The total is the weighted mean of the components that HAVE a value, the weights
 * renormalised — a page with no traffic yet is scored on what it can be scored on,
 * not dragged to zero. The weights are data (`PAGE_SCORE_WEIGHTS`).
 */

import type {
  ReplayPageA11yFacts,
  ReplayPageLabPerf,
  ReplayPageScoreDto,
  ReplayPageSeoFacts,
} from '@builderforce/interaction-contract';
import type { PageBehaviour, PageVitals } from './prescriptions/pageFacts';

export interface PageScoreWeights {
  conversion: number;
  frustration: number;
  seo: number;
  performance: number;
  accessibility: number;
}

export const PAGE_SCORE_WEIGHTS: Readonly<PageScoreWeights> = {
  conversion: 0.3,
  frustration: 0.2,
  seo: 0.2,
  performance: 0.15,
  accessibility: 0.15,
};

/** Sessions a behaviour component needs before it is scored. */
export const PAGE_SCORE_MIN_SESSIONS = 30;

/** Core Web Vitals "good" lines (LCP / INP ms, CLS × 1000). */
export const CWV_GOOD = { lcpMs: 2_500, cls: 100, inpMs: 200 } as const;

export interface PageScoreFacts {
  seo: ReplayPageSeoFacts | null;
  labPerf: ReplayPageLabPerf | null;
  a11y: ReplayPageA11yFacts | null;
  /** The page's behaviour on the capture's device. */
  behaviour: PageBehaviour;
  site: { sessions: number; conversions: number };
  vitals: PageVitals;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));
const round = (n: number): number => Math.round(n);

function conversionScore(f: PageScoreFacts): number | null {
  if (f.behaviour.sessions < PAGE_SCORE_MIN_SESSIONS || f.site.sessions <= 0 || f.site.conversions <= 0) return null;
  const pageRate = f.behaviour.conversions / f.behaviour.sessions;
  const siteRate = f.site.conversions / f.site.sessions;
  return round(clamp(50 * (pageRate / siteRate)));
}

function frustrationScore(f: PageScoreFacts): number | null {
  if (f.behaviour.sessions < PAGE_SCORE_MIN_SESSIONS) return null;
  return round(clamp(100 * (1 - f.behaviour.frustrated / f.behaviour.sessions)));
}

/** The on-page SEO checks, as data. */
export const SEO_CHECKS: ReadonlyArray<{ id: string; pass(seo: ReplayPageSeoFacts): boolean }> = [
  { id: 'title', pass: (s) => !!s.title && s.titleLength >= 30 && s.titleLength <= 60 },
  { id: 'meta_description', pass: (s) => !!s.metaDescription && s.metaDescriptionLength >= 50 },
  { id: 'one_h1', pass: (s) => s.h1Count === 1 },
  { id: 'heading_order', pass: (s) => s.headingOrderOk },
  { id: 'structured_data', pass: (s) => s.structuredDataTypes.length > 0 },
  { id: 'canonical', pass: (s) => !!s.canonical },
  { id: 'indexable', pass: (s) => s.indexable },
  { id: 'image_alt', pass: (s) => s.imageCount === 0 || s.imagesWithAlt / s.imageCount >= 0.9 },
  { id: 'social_card', pass: (s) => s.og.title && s.og.image },
];

function seoScore(f: PageScoreFacts): number | null {
  if (!f.seo) return null;
  const seo = f.seo;
  return round((100 * SEO_CHECKS.filter((c) => c.pass(seo)).length) / SEO_CHECKS.length);
}

function performanceScore(f: PageScoreFacts): number | null {
  const field = f.vitals.samples > 0;
  const lcp = field ? f.vitals.lcpP75 : f.labPerf?.lcpMs ?? null;
  const cls = field ? f.vitals.clsP75 : f.labPerf?.cls ?? null;
  const inp = field ? f.vitals.inpP75 : f.labPerf?.tbtMs ?? null;
  const checks = [
    lcp === null ? null : lcp <= CWV_GOOD.lcpMs,
    cls === null ? null : cls <= CWV_GOOD.cls,
    inp === null ? null : inp <= CWV_GOOD.inpMs,
  ].filter((c): c is boolean => c !== null);
  if (checks.length === 0) return null;
  return round((100 * checks.filter(Boolean).length) / checks.length);
}

/** Penalties per accessibility fact: points each, capped. */
export const A11Y_PENALTIES = {
  contrast: { each: 10, max: 40 },
  tapTarget: { each: 5, max: 25 },
  label: { each: 10, max: 30 },
  alt: { each: 5, max: 20 },
  focus: { each: 5, max: 10 },
} as const;

function accessibilityScore(f: PageScoreFacts): number | null {
  if (!f.a11y) return null;
  const a = f.a11y;
  const penalty = (count: number, p: { each: number; max: number }) => Math.min(p.max, count * p.each);
  return round(clamp(100
    - penalty(a.contrastFailures.length, A11Y_PENALTIES.contrast)
    - penalty(a.smallTapTargets.length, A11Y_PENALTIES.tapTarget)
    - penalty(a.missingLabels.length, A11Y_PENALTIES.label)
    - penalty(a.missingAlt.length, A11Y_PENALTIES.alt)
    - penalty(a.focusOrderIssues, A11Y_PENALTIES.focus)));
}

export function pageScore(facts: PageScoreFacts, weights: Readonly<PageScoreWeights> = PAGE_SCORE_WEIGHTS): ReplayPageScoreDto {
  const parts = {
    conversion: conversionScore(facts),
    frustration: frustrationScore(facts),
    seo: seoScore(facts),
    performance: performanceScore(facts),
    accessibility: accessibilityScore(facts),
  };
  let weighted = 0;
  let total = 0;
  for (const key of Object.keys(parts) as Array<keyof PageScoreWeights>) {
    const value = parts[key];
    const weight = Math.max(0, weights[key]);
    if (value === null || weight === 0) continue;
    weighted += value * weight;
    total += weight;
  }
  return { total: total > 0 ? round(weighted / total) : 0, ...parts };
}
