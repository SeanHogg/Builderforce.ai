/**
 * What the page-review rules read about one key page (PRD 33 §5.2, D14) — pure.
 *
 * The application assembles ONE `PageFacts` per key page (`pageAggregates.ts`): the
 * newest capture of each device (the runner's SEO / content / lab / accessibility
 * facts), the page's FIELD vitals p75 from `replay_vitals_daily`, its behaviour from
 * `replay_route_daily`, and — only when Search Console is connected — its search
 * numbers. A missing measure is null or `connected: false`, never a zero: a rule
 * that cannot see a fact does not fire on it.
 */

import type {
  ReplayPageA11yFacts,
  ReplayPageContentFacts,
  ReplayPageLabPerf,
  ReplayPageSeoFacts,
} from '@builderforce/interaction-contract';

/** One device's newest capture of the page. */
export interface PageCaptureFacts {
  captureId: string;
  releaseKey: string;
  seo: ReplayPageSeoFacts | null;
  content: ReplayPageContentFacts | null;
  labPerf: ReplayPageLabPerf | null;
  a11y: ReplayPageA11yFacts | null;
}

/** Sessions and conversions on the page's route, for one device or all. */
export interface PageBehaviour {
  sessions: number;
  conversions: number;
  frustrated: number;
}

/** Field p75 (the vitals histogram) — LCP / INP in ms, CLS × 1000; null without samples. */
export interface PageVitals {
  lcpP75: number | null;
  clsP75: number | null;
  inpP75: number | null;
  samples: number;
}

/** Search Console for this page, or an honest "not connected". Never fabricated zeros. */
export type PageSearchFacts =
  | { connected: false }
  | { connected: true; found: false }
  | {
    connected: true;
    found: true;
    impressions: number;
    clicks: number;
    ctr: number;
    /** The property's CTR over every page read in the same window (the comparison cohort). */
    siteCtr: number | null;
  };

export interface PageFacts {
  path: string;
  captures: { desktop: PageCaptureFacts | null; phone: PageCaptureFacts | null };
  behaviour: { all: PageBehaviour; desktop: PageBehaviour; phone: PageBehaviour };
  /** The site's totals over the same window (the page's comparison cohort). */
  site: { sessions: number; conversions: number };
  vitals: { desktop: PageVitals; phone: PageVitals };
  search: PageSearchFacts;
}

export const EMPTY_BEHAVIOUR: PageBehaviour = { sessions: 0, conversions: 0, frustrated: 0 };
export const EMPTY_VITALS: PageVitals = { lcpP75: null, clsP75: null, inpP75: null, samples: 0 };

/** The capture a rule reads first: desktop, else phone. */
export function primaryCapture(page: PageFacts): PageCaptureFacts | null {
  return page.captures.desktop ?? page.captures.phone;
}

/**
 * A flat `metric → value` map of every measured fact of a page — what a vision
 * finding's `supportingMetric` must name (`acceptObserved`). Absent facts are absent.
 */
export function pageFactKeys(page: PageFacts): Record<string, number> {
  const out: Record<string, number> = {};
  const put = (key: string, value: number | null | undefined) => {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  };
  for (const device of ['desktop', 'phone'] as const) {
    const capture = page.captures[device];
    if (capture?.seo) {
      put(`${device}.seo.titleLength`, capture.seo.titleLength);
      put(`${device}.seo.metaDescriptionLength`, capture.seo.metaDescriptionLength);
      put(`${device}.seo.h1Count`, capture.seo.h1Count);
      put(`${device}.seo.wordCount`, capture.seo.wordCount);
      put(`${device}.seo.imagesWithoutAlt`, capture.seo.imageCount - capture.seo.imagesWithAlt);
    }
    if (capture?.content) {
      put(`${device}.content.ctaCount`, capture.content.ctaCount);
      put(`${device}.content.ctaAboveFold`, capture.content.ctaAboveFold);
      put(`${device}.content.aboveFoldWords`, capture.content.aboveFoldWords);
      put(`${device}.content.readabilityGrade`, capture.content.readabilityGrade);
      put(`${device}.content.formFields`, capture.content.formFields);
      put(`${device}.content.trustSignals`, capture.content.trustSignals.length);
    }
    if (capture?.labPerf) {
      put(`${device}.lab.lcpMs`, capture.labPerf.lcpMs);
      put(`${device}.lab.cls`, capture.labPerf.cls);
      put(`${device}.lab.tbtMs`, capture.labPerf.tbtMs);
      put(`${device}.lab.pageWeightBytes`, capture.labPerf.pageWeightBytes);
      put(`${device}.lab.requestCount`, capture.labPerf.requestCount);
    }
    if (capture?.a11y) {
      put(`${device}.a11y.contrastFailures`, capture.a11y.contrastFailures.length);
      put(`${device}.a11y.smallTapTargets`, capture.a11y.smallTapTargets.length);
      put(`${device}.a11y.missingLabels`, capture.a11y.missingLabels.length);
      put(`${device}.a11y.missingAlt`, capture.a11y.missingAlt.length);
    }
    const vitals = page.vitals[device];
    put(`${device}.field.lcpP75`, vitals.lcpP75);
    put(`${device}.field.clsP75`, vitals.clsP75);
    put(`${device}.field.inpP75`, vitals.inpP75);
    const behaviour = page.behaviour[device];
    put(`${device}.sessions`, behaviour.sessions);
    if (behaviour.sessions > 0) put(`${device}.conversionRate`, behaviour.conversions / behaviour.sessions);
  }
  put('sessions', page.behaviour.all.sessions);
  if (page.behaviour.all.sessions > 0) {
    put('conversionRate', page.behaviour.all.conversions / page.behaviour.all.sessions);
    put('frustratedRate', page.behaviour.all.frustrated / page.behaviour.all.sessions);
  }
  if (page.search.connected && page.search.found) {
    put('search.impressions', page.search.impressions);
    put('search.clicks', page.search.clicks);
    put('search.ctr', page.search.ctr);
  }
  return out;
}
