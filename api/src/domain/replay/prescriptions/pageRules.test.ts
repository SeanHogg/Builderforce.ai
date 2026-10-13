/**
 * Every page-review rule (PRD 33 §5.2) fires on its fixture and stays silent on a
 * near miss; SEO rules count clicks and never invent a search number; the tap-target
 * rule reads the phone capture and the device split.
 */
import { describe, expect, it } from 'vitest';
import type {
  ReplayPageA11yFacts,
  ReplayPageContentFacts,
  ReplayPageLabPerf,
  ReplayPageSeoFacts,
} from '@builderforce/interaction-contract';
import { PRESCRIPTION_RULE_BY_ID } from './rules';
import { conversionCohorts, OBSERVED_RULE_ID } from './pageRules';
import { EMPTY_VITALS, pageFactKeys, type PageCaptureFacts, type PageFacts } from './pageFacts';
import type { SiteAggregates } from './types';

const seo = (over: Partial<ReplayPageSeoFacts> = {}): ReplayPageSeoFacts => ({
  title: 'Acme shoes — fast delivery across Europe', titleLength: 41, metaDescription: 'x'.repeat(120), metaDescriptionLength: 120,
  canonical: '/pricing', robots: null, indexable: true, h1Count: 1, headingLevels: [1, 2, 2], headingOrderOk: true,
  og: { title: true, description: true, image: true }, twitterCard: true, structuredDataTypes: ['Product'],
  imageCount: 4, imagesWithAlt: 4, internalLinks: 12, externalLinks: 1, wordCount: 600, hreflang: [],
  ...over,
});

const content = (over: Partial<ReplayPageContentFacts> = {}): ReplayPageContentFacts => ({
  aboveFoldText: 'Shoes that last', aboveFoldWords: 30, valuePropAboveFold: true, ctaLabels: ['Start free trial'], ctaCount: 1,
  ctaAboveFold: 1, readabilityGrade: 8, readingTimeSec: 120, formFields: 0, trustSignals: ['review'],
  ...over,
});

const lab = (over: Partial<ReplayPageLabPerf> = {}): ReplayPageLabPerf => ({
  lcpMs: 1800, cls: 20, tbtMs: 100, pageWeightBytes: 900_000, requestCount: 40,
  largestImages: [{ url: 'https://shop.example/hero.jpg', bytes: 120_000, selector: 'getByTestId("hero")', aboveFold: true }],
  renderBlocking: [],
  ...over,
});

const a11y = (over: Partial<ReplayPageA11yFacts> = {}): ReplayPageA11yFacts => ({
  contrastFailures: [], smallTapTargets: [], missingLabels: [], missingAlt: [], focusOrderIssues: 0,
  ...over,
});

const capture = (id: string, over: Partial<PageCaptureFacts> = {}): PageCaptureFacts => ({
  captureId: id, releaseKey: 'r1', seo: seo(), content: content(), labPerf: lab(), a11y: a11y(), ...over,
});

function page(over: Partial<PageFacts> = {}): PageFacts {
  return {
    path: '/pricing',
    captures: { desktop: capture('c-desk'), phone: capture('c-phone') },
    behaviour: {
      all: { sessions: 1_000, conversions: 20, frustrated: 50 },
      desktop: { sessions: 600, conversions: 16, frustrated: 20 },
      phone: { sessions: 400, conversions: 4, frustrated: 30 },
    },
    site: { sessions: 10_000, conversions: 400 },
    vitals: { desktop: { ...EMPTY_VITALS, lcpP75: 1_500, clsP75: 50, samples: 200 }, phone: { ...EMPTY_VITALS, lcpP75: 2_000, clsP75: 80, samples: 200 } },
    search: { connected: false },
    ...over,
  };
}

const agg = (pages: PageFacts[]): SiteAggregates => ({
  siteId: 's1', days: 30, grid: 50, site: { sessions: 10_000, conversions: 400 },
  routes: [], issues: [], elements: [], scroll: [], funnelSteps: [], devices: [], releases: [],
  knownCohorts: [], proofs: [], patterns: [], pages,
});

const run = (id: string, p: PageFacts) => PRESCRIPTION_RULE_BY_ID.get(id)!.detect(agg([p]));
const withDesktop = (over: Partial<PageCaptureFacts>) => page({ captures: { desktop: capture('c-desk', over), phone: capture('c-phone') } });

describe('a clean page', () => {
  it('fires no page rule', () => {
    for (const rule of PRESCRIPTION_RULE_BY_ID.values()) {
      if (rule.id === OBSERVED_RULE_ID) continue;
      expect(rule.detect(agg([page()])), rule.id).toEqual([]);
    }
  });

  it('carries the page path and the capture on every finding', () => {
    const [f] = run('seo_multiple_h1', withDesktop({ seo: seo({ h1Count: 3 }) }));
    expect(f).toMatchObject({ pagePath: '/pricing', captureId: 'c-desk', subjectKey: '/pricing|h1', area: 'seo', impactUnit: 'clicks' });
  });
});

describe('seo rules', () => {
  it('seo_title_length: outside 30..60', () => {
    expect(run('seo_title_length', withDesktop({ seo: seo({ titleLength: 72 }) }))).toHaveLength(1);
    expect(run('seo_title_length', withDesktop({ seo: seo({ title: null, titleLength: 0 }) }))).toHaveLength(1);
    expect(run('seo_title_length', withDesktop({ seo: seo({ titleLength: 60 }) }))).toEqual([]);
    expect(run('seo_title_length', withDesktop({ seo: seo({ titleLength: 72, indexable: false }) }))).toEqual([]);
  });

  it('seo_missing_meta_description: absent or under 50', () => {
    expect(run('seo_missing_meta_description', withDesktop({ seo: seo({ metaDescription: null, metaDescriptionLength: 0 }) }))).toHaveLength(1);
    expect(run('seo_missing_meta_description', withDesktop({ seo: seo({ metaDescriptionLength: 50 }) }))).toEqual([]);
  });

  it('seo_multiple_h1: more than one', () => {
    expect(run('seo_multiple_h1', withDesktop({ seo: seo({ h1Count: 2 }) }))).toHaveLength(1);
    expect(run('seo_multiple_h1', withDesktop({ seo: seo({ h1Count: 1 }) }))).toEqual([]);
  });

  it('seo_no_structured_data: an indexable page with words and no JSON-LD', () => {
    expect(run('seo_no_structured_data', withDesktop({ seo: seo({ structuredDataTypes: [] }) }))).toHaveLength(1);
    expect(run('seo_no_structured_data', withDesktop({ seo: seo({ structuredDataTypes: [], wordCount: 149 }) }))).toEqual([]);
  });

  it('seo_low_ctr_high_impressions: only with Search Console connected and the page found', () => {
    const search = { connected: true as const, found: true as const, impressions: 5_000, clicks: 40, ctr: 0.008, siteCtr: 0.03 };
    const [f] = run('seo_low_ctr_high_impressions', page({ search }));
    expect(f).toMatchObject({ affected: 5_000, impactUnit: 'clicks', cohorts: { with: { visits: 5_000, conversions: 40 }, without: { visits: 5_000, conversions: 150 } } });
    expect(run('seo_low_ctr_high_impressions', page({ search: { ...search, ctr: 0.016 } }))).toEqual([]);
    expect(run('seo_low_ctr_high_impressions', page({ search: { ...search, impressions: 999 } }))).toEqual([]);
    expect(run('seo_low_ctr_high_impressions', page({ search: { connected: false } }))).toEqual([]);
    expect(run('seo_low_ctr_high_impressions', page({ search: { connected: true, found: false } }))).toEqual([]);
  });

  it('without Search Console an SEO finding has no cohort (no invented number)', () => {
    const [f] = run('seo_multiple_h1', withDesktop({ seo: seo({ h1Count: 2 }) }));
    expect(f!.cohorts).toBeNull();
    expect(f!.affected).toBe(1_000);
  });
});

describe('content rules', () => {
  it('content_no_value_prop_above_fold: missing on either device', () => {
    expect(run('content_no_value_prop_above_fold', withDesktop({ content: content({ valuePropAboveFold: false }) }))).toHaveLength(1);
    const phoneOnly = page({ captures: { desktop: capture('c-desk'), phone: capture('c-phone', { content: content({ valuePropAboveFold: false }) }) } });
    expect(run('content_no_value_prop_above_fold', phoneOnly)[0]!.params).toMatchObject({ device: 'phone' });
    expect(run('content_no_value_prop_above_fold', page())).toEqual([]);
  });

  it('content_cta_vague: a label that does not say what happens', () => {
    const [f] = run('content_cta_vague', withDesktop({ content: content({ ctaLabels: ['Learn more', 'Start free trial'] }) }));
    expect(f).toMatchObject({ subjectKey: '/pricing|cta:learn more', label: 'Learn more' });
    expect(run('content_cta_vague', withDesktop({ content: content({ ctaLabels: ['Learn more about pricing'] }) }))).toEqual([]);
  });

  it('content_readability: grade above 12 with enough words', () => {
    expect(run('content_readability', withDesktop({ content: content({ readabilityGrade: 14.2 }) }))).toHaveLength(1);
    expect(run('content_readability', withDesktop({ content: content({ readabilityGrade: 12 }) }))).toEqual([]);
  });

  it('content_missing_trust: asks to act with no trust signal', () => {
    const [f] = run('content_missing_trust', withDesktop({ content: content({ trustSignals: [] }) }));
    expect(f!.cohorts).toEqual({ with: { visits: 1_000, conversions: 20 }, without: { visits: 9_000, conversions: 380 }, estimated: false });
    expect(run('content_missing_trust', withDesktop({ content: content({ trustSignals: [], ctaCount: 0, formFields: 0 }) }))).toEqual([]);
  });
});

describe('performance rules', () => {
  it('perf_lcp_poor: field p75 over 2.5 s on the worse device', () => {
    const slow = page({ vitals: { desktop: { ...EMPTY_VITALS, lcpP75: 1_200, samples: 100 }, phone: { ...EMPTY_VITALS, lcpP75: 4_000, samples: 100 } } });
    expect(run('perf_lcp_poor', slow)[0]!.params).toMatchObject({ p75: 4_000, device: 'phone' });
    expect(run('perf_lcp_poor', page({ vitals: { desktop: { ...EMPTY_VITALS, lcpP75: 2_500, samples: 100 }, phone: EMPTY_VITALS } }))).toEqual([]);
    expect(run('perf_lcp_poor', page({ vitals: { desktop: { ...EMPTY_VITALS, lcpP75: 9_000, samples: 5 }, phone: EMPTY_VITALS } }))).toEqual([]);
  });

  it('perf_cls_poor: field p75 over 0.1', () => {
    expect(run('perf_cls_poor', page({ vitals: { desktop: { ...EMPTY_VITALS, clsP75: 250, samples: 100 }, phone: EMPTY_VITALS } }))).toHaveLength(1);
    expect(run('perf_cls_poor', page({ vitals: { desktop: { ...EMPTY_VITALS, clsP75: 100, samples: 100 }, phone: EMPTY_VITALS } }))).toEqual([]);
  });

  it('perf_heavy_hero_image: an above-the-fold image over 300 KB', () => {
    const heavy = lab({ largestImages: [{ url: 'https://shop.example/hero.png', bytes: 900_000, selector: 'getByTestId("hero")', aboveFold: true }] });
    expect(run('perf_heavy_hero_image', withDesktop({ labPerf: heavy }))[0]).toMatchObject({ selector: 'getByTestId("hero")', params: { kb: 879 } });
    const below = lab({ largestImages: [{ url: 'https://shop.example/footer.png', bytes: 900_000, selector: null, aboveFold: false }] });
    expect(run('perf_heavy_hero_image', withDesktop({ labPerf: below }))).toEqual([]);
  });
});

describe('accessibility rules', () => {
  it('a11y_contrast: names the worst element', () => {
    const failures = [{ selector: 'a', ratio: 3.2, required: 4.5 }, { selector: 'b', ratio: 1.9, required: 4.5 }];
    expect(run('a11y_contrast', withDesktop({ a11y: a11y({ contrastFailures: failures }) }))[0]).toMatchObject({ selector: 'b', params: { count: 2, ratio: 1.9 } });
    expect(run('a11y_contrast', page())).toEqual([]);
  });

  it('a11y_tap_targets: three or more small targets on the phone capture, impact by device split', () => {
    const small = [1, 2, 3].map((i) => ({ selector: `t${i}`, w: 30, h: 30 }));
    const p = page({ captures: { desktop: capture('c-desk'), phone: capture('c-phone', { a11y: a11y({ smallTapTargets: small }) }) } });
    const [f] = run('a11y_tap_targets', p);
    expect(f).toMatchObject({ captureId: 'c-phone', affected: 400, cohorts: { with: { visits: 400, conversions: 4 }, without: { visits: 600, conversions: 16 } } });
    const two = page({ captures: { desktop: capture('c-desk'), phone: capture('c-phone', { a11y: a11y({ smallTapTargets: small.slice(0, 2) }) }) } });
    expect(run('a11y_tap_targets', two)).toEqual([]);
    // Small targets on the DESKTOP capture are not a tap-target problem.
    expect(run('a11y_tap_targets', withDesktop({ a11y: a11y({ smallTapTargets: small }) }))).toEqual([]);
  });

  it('a11y_missing_labels: an input without a label', () => {
    expect(run('a11y_missing_labels', withDesktop({ a11y: a11y({ missingLabels: [{ selector: 'input#email' }] }) }))).toHaveLength(1);
    expect(run('a11y_missing_labels', page())).toEqual([]);
  });
});

describe('helpers', () => {
  it('conversionCohorts compares the page with the rest of the site', () => {
    expect(conversionCohorts(page({ site: { sessions: 1_000, conversions: 20 } }))).toBeNull();
  });

  it('pageFactKeys lists only measured facts', () => {
    const keys = pageFactKeys(page());
    expect(keys['desktop.seo.h1Count']).toBe(1);
    expect(keys['phone.field.lcpP75']).toBe(2_000);
    expect(keys['desktop.field.inpP75']).toBeUndefined();
    expect(keys['search.ctr']).toBeUndefined();
  });
});
