/**
 * The page score (PRD 33 §5.2 "Measure"): five 0..100 components, null without data,
 * and a total over only the components that have a value.
 */
import { describe, expect, it } from 'vitest';
import type { ReplayPageSeoFacts } from '@builderforce/interaction-contract';
import { CWV_GOOD, PAGE_SCORE_WEIGHTS, pageScore, SEO_CHECKS, type PageScoreFacts } from './pageScore';
import { EMPTY_VITALS } from './prescriptions/pageFacts';

const seo: ReplayPageSeoFacts = {
  title: 'Acme shoes — fast delivery across Europe', titleLength: 41, metaDescription: 'x'.repeat(80), metaDescriptionLength: 80,
  canonical: '/', robots: null, indexable: true, h1Count: 1, headingLevels: [1, 2], headingOrderOk: true,
  og: { title: true, description: true, image: true }, twitterCard: true, structuredDataTypes: ['Organization'],
  imageCount: 2, imagesWithAlt: 2, internalLinks: 5, externalLinks: 0, wordCount: 400, hreflang: [],
};

function facts(over: Partial<PageScoreFacts> = {}): PageScoreFacts {
  return {
    seo,
    labPerf: { lcpMs: 1_800, cls: 20, tbtMs: 100, pageWeightBytes: 500_000, requestCount: 30, largestImages: [], renderBlocking: [] },
    a11y: { contrastFailures: [], smallTapTargets: [], missingLabels: [], missingAlt: [], focusOrderIssues: 0 },
    behaviour: { sessions: 1_000, conversions: 40, frustrated: 100 },
    site: { sessions: 10_000, conversions: 400 },
    vitals: { ...EMPTY_VITALS },
    ...over,
  };
}

describe('pageScore', () => {
  it('scores each component 0..100', () => {
    expect(pageScore(facts())).toEqual({ total: 83, conversion: 50, frustration: 90, seo: 100, performance: 100, accessibility: 100 });
  });

  it('weights the total by PAGE_SCORE_WEIGHTS over the components that have a value', () => {
    const score = pageScore(facts({ behaviour: { sessions: 10, conversions: 0, frustrated: 0 } }));
    expect(score.conversion).toBeNull();
    expect(score.frustration).toBeNull();
    // seo 100, performance 100, accessibility 100 → 100 whatever the weights.
    expect(score.total).toBe(100);
    const w = PAGE_SCORE_WEIGHTS;
    expect(w.conversion + w.frustration + w.seo + w.performance + w.accessibility).toBeCloseTo(1);
  });

  it('prefers field vitals over the lab load', () => {
    const slowField = facts({ vitals: { lcpP75: CWV_GOOD.lcpMs + 1, clsP75: 10, inpP75: 100, samples: 200 } });
    expect(pageScore(slowField).performance).toBe(67);
  });

  it('counts the SEO checks that pass', () => {
    const score = pageScore(facts({ seo: { ...seo, h1Count: 2, structuredDataTypes: [] } }));
    expect(score.seo).toBe(Math.round((100 * (SEO_CHECKS.length - 2)) / SEO_CHECKS.length));
  });

  it('caps accessibility penalties and never goes below zero', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ selector: `e${i}`, ratio: 2, required: 4.5, w: 10, h: 10 }));
    const score = pageScore(facts({
      a11y: { contrastFailures: many(10), smallTapTargets: many(10), missingLabels: many(10), missingAlt: many(10), focusOrderIssues: 9 },
    }));
    expect(score.accessibility).toBe(0);
  });

  it('is 0 with nothing to score', () => {
    expect(pageScore(facts({ seo: null, labPerf: null, a11y: null, behaviour: { sessions: 0, conversions: 0, frustrated: 0 } })))
      .toEqual({ total: 0, conversion: null, frustration: null, seo: null, performance: null, accessibility: null });
  });
});
