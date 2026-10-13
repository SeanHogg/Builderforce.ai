/**
 * THE page-review rules (PRD 33 §5.2 "Review", D13/D14) — data, pure, appended to
 * `PRESCRIPTION_RULES`.
 *
 * Each rule reads only `SiteAggregates.pages` (one `PageFacts` per key page) and
 * returns deterministic findings carrying the page path and the capture they were
 * read from. Impact models:
 *   • SEO — clicks: with Search Console connected, the page's own clicks/impressions
 *     against the property's CTR (`impactUnit: 'clicks'`); without it, no cohort and
 *     the visits the page gets (low confidence — never an invented search number);
 *   • content / performance / contrast / labels — the page's conversion against the
 *     rest of the site's, over the page's visits;
 *   • tap targets — the device split: the page's phone visits against its desktop ones.
 *
 * `vision_observed` is the rule row of a finding the ONE vision request observed and
 * `acceptObserved` kept (§5.2): it detects nothing itself; it carries the actions,
 * effort and acceptance those rows are offered with.
 */

import type { ReplayPrescriptionActionKind } from '@builderforce/interaction-contract';
import { primaryCapture, type PageCaptureFacts, type PageFacts } from './pageFacts';
import type { Finding, ImpactCohorts, PrescriptionRule, SiteAggregates } from './types';

/** The rule id of a vision-observed finding (`source = 'observed'`). */
export const OBSERVED_RULE_ID = 'vision_observed';

const PAGE_ACTIONS: readonly ReplayPrescriptionActionKind[] = ['fix', 'ticket', 'copy_prompt', 'apply_in_composer', 'apply_page'];
const TESTABLE_ACTIONS: readonly ReplayPrescriptionActionKind[] = ['fix', 'test', 'ticket', 'copy_prompt', 'apply_in_composer', 'apply_page'];

/** Labels that do not say what happens next. */
const VAGUE_CTA = /^(click here|here|submit|learn more|read more|more|go|continue|next|send|ok|details|find out more|see more)$/i;

const pct = (share: number): number => Math.round(share * 1000) / 10;
const pagesOf = (agg: SiteAggregates): PageFacts[] => agg.pages ?? [];

/** The page's conversion against the rest of the site's (null when there is no rest). */
export function conversionCohorts(page: PageFacts): ImpactCohorts | null {
  const rest = { visits: page.site.sessions - page.behaviour.all.sessions, conversions: page.site.conversions - page.behaviour.all.conversions };
  if (page.behaviour.all.sessions <= 0 || rest.visits <= 0 || rest.conversions < 0) return null;
  return {
    with: { visits: page.behaviour.all.sessions, conversions: page.behaviour.all.conversions },
    without: rest,
    estimated: false,
  };
}

/** The page's phone visits against its desktop visits. */
export function deviceCohorts(page: PageFacts): ImpactCohorts | null {
  const { phone, desktop } = page.behaviour;
  if (phone.sessions <= 0 || desktop.sessions <= 0) return null;
  return {
    with: { visits: phone.sessions, conversions: phone.conversions },
    without: { visits: desktop.sessions, conversions: desktop.conversions },
    estimated: false,
  };
}

/** Search clicks: the page's against the property's CTR, when Search Console found the page. */
export function searchCohorts(page: PageFacts): ImpactCohorts | null {
  const s = page.search;
  if (!s.connected || !s.found || s.siteCtr === null || s.impressions <= 0) return null;
  return {
    with: { visits: s.impressions, conversions: s.clicks },
    without: { visits: s.impressions, conversions: Math.round(s.impressions * s.siteCtr) },
    estimated: false,
  };
}

type Model = 'conversion' | 'device' | 'search';

function finding(
  rule: Pick<PrescriptionRule, 'id' | 'area'>,
  page: PageFacts,
  capture: PageCaptureFacts,
  input: { subject: string; params: Record<string, string | number>; selector?: string | null; label?: string | null; model: Model },
): Finding {
  const search = page.search.connected && page.search.found ? page.search : null;
  const affected = input.model === 'search'
    ? (search ? search.impressions : page.behaviour.all.sessions)
    : input.model === 'device' ? page.behaviour.phone.sessions : page.behaviour.all.sessions;
  const cohorts = input.model === 'search' ? searchCohorts(page) : input.model === 'device' ? deviceCohorts(page) : conversionCohorts(page);
  return {
    ruleId: rule.id,
    area: rule.area,
    subjectKey: `${page.path}|${input.subject}`.slice(0, 400),
    pagePath: page.path,
    params: { route: page.path, ...input.params },
    evidence: [],
    issueId: null,
    fingerprint: null,
    selector: input.selector ?? null,
    label: input.label ?? null,
    affected,
    cohorts,
    captureId: capture.captureId,
    ...(input.model === 'search' ? { impactUnit: 'clicks' } : {}),
  };
}

/** A rule over the primary capture of each page that has the facts it needs. */
function pageRule(
  def: Omit<PrescriptionRule, 'detect'> & {
    model: Model;
    check(page: PageFacts, capture: PageCaptureFacts, t: Readonly<Record<string, number>>): { subject: string; params: Record<string, string | number>; selector?: string | null; label?: string | null } | null;
    capture?: (page: PageFacts) => PageCaptureFacts | null;
  },
): PrescriptionRule {
  const { model, check, capture, ...rule } = def;
  return {
    ...rule,
    detect(agg) {
      const out: Finding[] = [];
      for (const page of pagesOf(agg)) {
        const c = (capture ?? primaryCapture)(page);
        if (!c) continue;
        const hit = check(page, c, rule.thresholds);
        if (hit) out.push(finding(rule, page, c, { ...hit, model }));
      }
      return out;
    },
  };
}

const SEO_ACCEPTANCE = { metric: 'search_clicks', direction: 'up', minVisits: 200 } as const;
const CONVERSION_ACCEPTANCE = { metric: 'conversion_rate', direction: 'up', minVisits: 500 } as const;

const seoTitleLength = pageRule({
  id: 'seo_title_length', area: 'seo', effort: 1, actions: PAGE_ACTIONS, model: 'search',
  thresholds: { min: 30, max: 60 }, acceptance: SEO_ACCEPTANCE,
  check(_page, c, t) {
    if (!c.seo || !c.seo.indexable) return null;
    const n = c.seo.title ? c.seo.titleLength : 0;
    if (n >= t.min! && n <= t.max!) return null;
    return { subject: 'title', params: { length: n, min: t.min!, max: t.max! } };
  },
});

const seoMissingMetaDescription = pageRule({
  id: 'seo_missing_meta_description', area: 'seo', effort: 1, actions: PAGE_ACTIONS, model: 'search',
  thresholds: { minLength: 50 }, acceptance: SEO_ACCEPTANCE,
  check(_page, c, t) {
    if (!c.seo || !c.seo.indexable) return null;
    const n = c.seo.metaDescription ? c.seo.metaDescriptionLength : 0;
    return n >= t.minLength! ? null : { subject: 'meta-description', params: { length: n, min: t.minLength! } };
  },
});

const seoMultipleH1 = pageRule({
  id: 'seo_multiple_h1', area: 'seo', effort: 1, actions: PAGE_ACTIONS, model: 'search',
  thresholds: { maxH1: 1 }, acceptance: SEO_ACCEPTANCE,
  check(_page, c, t) {
    if (!c.seo || c.seo.h1Count <= t.maxH1!) return null;
    return { subject: 'h1', params: { count: c.seo.h1Count } };
  },
});

const seoNoStructuredData = pageRule({
  id: 'seo_no_structured_data', area: 'seo', effort: 2, actions: PAGE_ACTIONS, model: 'search',
  thresholds: { minWords: 150 }, acceptance: SEO_ACCEPTANCE,
  check(_page, c, t) {
    if (!c.seo || !c.seo.indexable || c.seo.structuredDataTypes.length > 0 || c.seo.wordCount < t.minWords!) return null;
    return { subject: 'structured-data', params: { words: c.seo.wordCount } };
  },
});

const seoLowCtrHighImpressions = pageRule({
  id: 'seo_low_ctr_high_impressions', area: 'seo', effort: 1, actions: PAGE_ACTIONS, model: 'search',
  thresholds: { minImpressions: 1_000, maxCtrRatio: 0.5 }, acceptance: SEO_ACCEPTANCE,
  check(page, _c, t) {
    const s = page.search;
    // Only with Search Console connected and the page found in it — never a fabricated number.
    if (!s.connected || !s.found || s.siteCtr === null || s.siteCtr <= 0) return null;
    if (s.impressions < t.minImpressions! || s.ctr >= t.maxCtrRatio! * s.siteCtr) return null;
    return { subject: 'ctr', params: { impressions: s.impressions, clicks: s.clicks, ctr: pct(s.ctr), siteCtr: pct(s.siteCtr) } };
  },
});

const contentNoValueProp = pageRule({
  id: 'content_no_value_prop_above_fold', area: 'content', effort: 2, actions: TESTABLE_ACTIONS, model: 'conversion',
  thresholds: { minSessions: 50 }, acceptance: CONVERSION_ACCEPTANCE,
  check(page, c, t) {
    if (!c.content || page.behaviour.all.sessions < t.minSessions!) return null;
    const phone = page.captures.phone?.content;
    const missing = !c.content.valuePropAboveFold || (phone ? !phone.valuePropAboveFold : false);
    if (!missing) return null;
    return { subject: 'value-prop', params: { words: c.content.aboveFoldWords, device: c.content.valuePropAboveFold ? 'phone' : 'desktop' } };
  },
});

const contentCtaVague = pageRule({
  id: 'content_cta_vague', area: 'content', effort: 1, actions: TESTABLE_ACTIONS, model: 'conversion',
  thresholds: { minSessions: 50 }, acceptance: CONVERSION_ACCEPTANCE,
  check(page, c, t) {
    if (!c.content || page.behaviour.all.sessions < t.minSessions!) return null;
    const vague = c.content.ctaLabels.find((label) => VAGUE_CTA.test(label.trim()));
    if (!vague) return null;
    return { subject: `cta:${vague.trim().toLowerCase()}`, params: { label: vague.trim(), ctas: c.content.ctaCount }, label: vague.trim() };
  },
});

const contentReadability = pageRule({
  id: 'content_readability', area: 'content', effort: 2, actions: TESTABLE_ACTIONS, model: 'conversion',
  thresholds: { maxGrade: 12, minWords: 150 }, acceptance: CONVERSION_ACCEPTANCE,
  check(_page, c, t) {
    const grade = c.content?.readabilityGrade ?? null;
    if (grade === null || !c.seo || c.seo.wordCount < t.minWords! || grade <= t.maxGrade!) return null;
    return { subject: 'readability', params: { grade: Math.round(grade * 10) / 10, max: t.maxGrade! } };
  },
});

const contentMissingTrust = pageRule({
  id: 'content_missing_trust', area: 'content', effort: 2, actions: TESTABLE_ACTIONS, model: 'conversion',
  thresholds: { minSessions: 50 }, acceptance: CONVERSION_ACCEPTANCE,
  check(page, c, t) {
    if (!c.content || page.behaviour.all.sessions < t.minSessions!) return null;
    const asksToAct = c.content.ctaCount > 0 || c.content.formFields > 0;
    if (!asksToAct || c.content.trustSignals.length > 0) return null;
    return { subject: 'trust', params: { ctas: c.content.ctaCount, fields: c.content.formFields } };
  },
});

/** The worse of the two devices' field p75 for a metric, and which device. */
function worstField(page: PageFacts, key: 'lcpP75' | 'clsP75', minSamples: number): { value: number; device: string } | null {
  const candidates = (['desktop', 'phone'] as const)
    .filter((d) => page.vitals[d].samples >= minSamples && page.vitals[d][key] !== null)
    .map((d) => ({ value: page.vitals[d][key]!, device: d }));
  return candidates.sort((a, b) => b.value - a.value)[0] ?? null;
}

const perfLcpPoor = pageRule({
  id: 'perf_lcp_poor', area: 'performance', effort: 2, actions: PAGE_ACTIONS, model: 'conversion',
  thresholds: { maxLcpMs: 2_500, minSamples: 30 }, acceptance: { metric: 'lcp_p75', direction: 'down', minVisits: 300 },
  check(page, _c, t) {
    const worst = worstField(page, 'lcpP75', t.minSamples!);
    if (!worst || worst.value <= t.maxLcpMs!) return null;
    return { subject: 'lcp', params: { p75: worst.value, max: t.maxLcpMs!, device: worst.device } };
  },
});

const perfClsPoor = pageRule({
  id: 'perf_cls_poor', area: 'performance', effort: 2, actions: PAGE_ACTIONS, model: 'conversion',
  // CLS × 1000 (VITAL_BUCKETS): 100 is the 0.1 "good" line.
  thresholds: { maxCls: 100, minSamples: 30 }, acceptance: { metric: 'cls_p75', direction: 'down', minVisits: 300 },
  check(page, _c, t) {
    const worst = worstField(page, 'clsP75', t.minSamples!);
    if (!worst || worst.value <= t.maxCls!) return null;
    return { subject: 'cls', params: { p75: worst.value / 1000, max: t.maxCls! / 1000, device: worst.device } };
  },
});

const perfHeavyHeroImage = pageRule({
  id: 'perf_heavy_hero_image', area: 'performance', effort: 1, actions: PAGE_ACTIONS, model: 'conversion',
  thresholds: { maxBytes: 300_000 }, acceptance: { metric: 'lcp_p75', direction: 'down', minVisits: 300 },
  check(_page, c, t) {
    const hero = c.labPerf?.largestImages.find((img) => img.aboveFold && img.bytes > t.maxBytes!);
    if (!hero) return null;
    return { subject: `image:${hero.url.slice(0, 200)}`, params: { kb: Math.round(hero.bytes / 1024), maxKb: Math.round(t.maxBytes! / 1024) }, selector: hero.selector };
  },
});

const a11yContrast = pageRule({
  id: 'a11y_contrast', area: 'accessibility', effort: 1, actions: PAGE_ACTIONS, model: 'conversion',
  thresholds: { minFailures: 1 }, acceptance: CONVERSION_ACCEPTANCE,
  check(_page, c, t) {
    const failures = c.a11y?.contrastFailures ?? [];
    if (failures.length < t.minFailures!) return null;
    const worst = [...failures].sort((a, b) => a.ratio - b.ratio)[0]!;
    return { subject: 'contrast', params: { count: failures.length, ratio: Math.round(worst.ratio * 100) / 100, required: worst.required }, selector: worst.selector };
  },
});

const a11yTapTargets = pageRule({
  id: 'a11y_tap_targets', area: 'accessibility', effort: 1, actions: PAGE_ACTIONS, model: 'device',
  thresholds: { minTargets: 3, minSize: 44 }, acceptance: { metric: 'phone_conversion_rate', direction: 'up', minVisits: 500 },
  capture: (page) => page.captures.phone,
  check(_page, c, t) {
    const small = c.a11y?.smallTapTargets ?? [];
    if (small.length < t.minTargets!) return null;
    return { subject: 'tap-targets', params: { count: small.length, min: t.minSize! }, selector: small[0]!.selector };
  },
});

const a11yMissingLabels = pageRule({
  id: 'a11y_missing_labels', area: 'accessibility', effort: 1, actions: PAGE_ACTIONS, model: 'conversion',
  thresholds: { minMissing: 1 }, acceptance: CONVERSION_ACCEPTANCE,
  check(_page, c, t) {
    const missing = c.a11y?.missingLabels ?? [];
    if (missing.length < t.minMissing!) return null;
    return { subject: 'labels', params: { count: missing.length }, selector: missing[0]!.selector };
  },
});

/** The row a vision-observed finding is stored under; it detects nothing itself. */
const visionObserved: PrescriptionRule = {
  id: OBSERVED_RULE_ID,
  area: 'ux',
  effort: 2,
  actions: TESTABLE_ACTIONS,
  thresholds: {},
  acceptance: CONVERSION_ACCEPTANCE,
  detect: () => [],
};

/** Every page-review rule, in display order. */
export const PAGE_PRESCRIPTION_RULES: readonly PrescriptionRule[] = [
  seoTitleLength,
  seoMissingMetaDescription,
  seoMultipleH1,
  seoNoStructuredData,
  seoLowCtrHighImpressions,
  contentNoValueProp,
  contentCtaVague,
  contentReadability,
  contentMissingTrust,
  perfLcpPoor,
  perfClsPoor,
  perfHeavyHeroImage,
  a11yContrast,
  a11yTapTargets,
  a11yMissingLabels,
  visionObserved,
];

/** Areas whose fixes are drafted with a visual patch (a rendered before/after). */
export const VISUAL_AREAS: ReadonlySet<string> = new Set(['ux', 'content', 'seo', 'accessibility']);
