/**
 * THE prescription rules (PRD 33 §5.1.1, D13) — DATA, not branches, and pure.
 *
 * Each rule is `{ id, area, effort, actions, thresholds, acceptance, detect }`;
 * `detect` reads only the `SiteAggregates` it is handed and returns deterministic
 * findings. A finding names its subject (`subjectKey`, unique per site and rule —
 * the sweep upserts on it), its title params, the recordings that show it and the
 * cohorts its impact is computed from. Nothing here phrases anything: the AI only
 * words a finding that a rule already proved.
 *
 * The §5.2 page-review rules (`pageRules.ts`) close the list.
 */

import { rowDecile, selectorKind } from '../heatInsightRules';
import { PAGE_PRESCRIPTION_RULES } from './pageRules';
import type { ElementAggregate, Finding, IssueAggregate, PrescriptionRule, SiteAggregates } from './types';

const EVIDENCE_MAX = 3;
const pct = (share: number): number => Math.round(share * 1000) / 10;
const rate = (c: { sessions: number; conversions: number }): number => (c.sessions > 0 ? c.conversions / c.sessions : 0);

const evidenceOf = (ids: readonly string[]) => ids.slice(0, EVIDENCE_MAX).map((recordingId) => ({ recordingId, atMs: 0 }));

/** A short stable hash (djb2, hex) — a subject key for a finding with no natural id. */
export function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** A heading: an `h1`–`h6` tag or a `heading` role. */
export function isHeadingSelector(selector: string): boolean {
  if (/^getByRole\("heading"/.test(selector.trim())) return true;
  const last = selector.split('>').pop()!.trim();
  return /^h[1-6](?![a-z0-9-])/i.test(last);
}

const CTA_WORDS = /\b(sign ?up|get started|start|try|buy|order|book|subscribe|join|register|contact|demo|download|checkout|add to cart|pricing|upgrade)\b/i;

/** A call to action: an interactive element whose label asks the visitor to act. */
export function isCta(element: Pick<ElementAggregate, 'selector' | 'label'>): boolean {
  if (selectorKind(element.selector) !== 'interactive') return false;
  return CTA_WORDS.test(element.label ?? '') || CTA_WORDS.test(element.selector);
}

const OBJECTION_WORDS = /\b(price|pricing|expensive|cost|fee|trust|secur|privacy|shipping|delivery|refund|return|compar|hesitat|unclear|confus|doubt|risk|contract|cancel)/i;

function labelFor(agg: SiteAggregates, route: string, selector: string): string | null {
  return agg.elements.find((e) => e.route === route && e.selector === selector)?.label ?? null;
}

/** A finding about one issue group: its sessions, its share, its representatives, its cohorts. */
function issueFinding(
  rule: { id: string; area: Finding['area'] },
  agg: SiteAggregates,
  issue: IssueAggregate,
  extra: { selector?: boolean; params?: Record<string, string | number> } = {},
): Finding {
  const selector = extra.selector ? issue.subject : null;
  const label = selector ? labelFor(agg, issue.route, selector) : null;
  return {
    ruleId: rule.id,
    area: rule.area,
    subjectKey: `${issue.route}|${issue.subject}`.slice(0, 400),
    pagePath: issue.route,
    params: { route: issue.route, label: label ?? issue.subject, share: pct(issue.share), sessions: issue.sessions, ...extra.params },
    evidence: evidenceOf(issue.recordingIds),
    issueId: issue.id,
    fingerprint: issue.fingerprint,
    selector,
    label,
    affected: issue.sessions,
    cohorts: issue.cohorts,
  };
}

/** Issues of `kind` on routes with enough traffic whose share passes `minShare`. */
function issuesOver(agg: SiteAggregates, kind: string, minRouteSessions: number, minShare: number, minSessions = 1): IssueAggregate[] {
  return agg.issues.filter((i) => i.kind === kind && i.routeSessions >= minRouteSessions && i.share >= minShare && i.sessions >= minSessions);
}

const rageOnElement: PrescriptionRule = {
  id: 'rage_on_element',
  area: 'ux',
  effort: 1,
  actions: ['fix', 'test', 'ticket'],
  thresholds: { minRouteSessions: 50, minShare: 0.03 },
  acceptance: { metric: 'rage_rate', direction: 'down', minVisits: 200 },
  detect(agg) {
    const t = this.thresholds;
    return issuesOver(agg, 'rage', t.minRouteSessions!, t.minShare!).map((issue) => issueFinding(this, agg, issue, { selector: true }));
  },
};

const errorOnStep: PrescriptionRule = {
  id: 'error_on_step',
  area: 'funnel',
  effort: 2,
  actions: ['fix', 'ticket'],
  thresholds: { minDropsSampled: 5, minShareOfDrops: 0.3 },
  acceptance: { metric: 'step_conversion', direction: 'up', minVisits: 200 },
  detect(agg) {
    const t = this.thresholds;
    const out: Finding[] = [];
    for (const step of agg.funnelSteps) {
      if (step.droppedSampled < t.minDropsSampled!) continue;
      const top = [...step.dropErrors].sort((a, b) => b.drops - a.drops)[0];
      if (!top) continue;
      const share = top.drops / step.droppedSampled;
      if (share < t.minShareOfDrops!) continue;
      const issue = agg.issues.find((i) => i.fingerprint === top.fingerprint) ?? null;
      out.push({
        ruleId: this.id,
        area: this.area,
        subjectKey: `${step.funnelId}:${step.ord}:${top.fingerprint}`,
        pagePath: top.route || null,
        params: { funnel: step.funnelName, step: step.label, share: pct(share), error: top.subject },
        evidence: evidenceOf(top.recordingIds),
        issueId: top.issueId,
        fingerprint: top.fingerprint,
        selector: null,
        label: null,
        affected: Math.round(Math.max(0, step.prevVisits - step.visits) * share),
        cohorts: issue?.cohorts ?? null,
      });
    }
    return out;
  },
};

const deadClickHeading: PrescriptionRule = {
  id: 'dead_click_heading',
  area: 'ux',
  effort: 1,
  actions: ['fix', 'ticket'],
  thresholds: { minRouteSessions: 50, minShare: 0.02, minSessions: 10 },
  acceptance: { metric: 'dead_click_rate', direction: 'down', minVisits: 200 },
  detect(agg) {
    const t = this.thresholds;
    return issuesOver(agg, 'dead', t.minRouteSessions!, t.minShare!, t.minSessions!)
      .filter((issue) => isHeadingSelector(issue.subject))
      .map((issue) => issueFinding(this, agg, issue, { selector: true }));
  },
};

const ctaBelowFold: PrescriptionRule = {
  id: 'cta_below_fold',
  area: 'site',
  effort: 2,
  actions: ['fix', 'test', 'ticket'],
  thresholds: { minScrollSessions: 50, minClicks: 10, maxReach: 0.4 },
  acceptance: { metric: 'conversion_rate', direction: 'up', minVisits: 500 },
  detect(agg) {
    const t = this.thresholds;
    const out: Finding[] = [];
    for (const scroll of agg.scroll) {
      if (scroll.sessions < t.minScrollSessions!) continue;
      const cta = agg.elements
        .filter((e) => e.route === scroll.route && e.clicks >= t.minClicks! && e.medianGy !== null && isCta(e))
        .sort((a, b) => b.clicks - a.clicks)[0];
      if (!cta) continue;
      const decile = rowDecile(cta.medianGy!, agg.grid);
      const reach = scroll.reach[decile] ?? 0;
      if (reach >= t.maxReach!) continue;
      out.push({
        ruleId: this.id,
        area: this.area,
        subjectKey: `${scroll.route}|${cta.selector}`.slice(0, 400),
        pagePath: scroll.route,
        params: { route: scroll.route, label: cta.label ?? cta.selector, reach: pct(reach), decile },
        evidence: [],
        issueId: null,
        fingerprint: null,
        selector: cta.selector,
        label: cta.label,
        affected: Math.round(scroll.sessions * (1 - reach)),
        cohorts: null,
      });
    }
    return out;
  },
};

const quickbackAfterReveal: PrescriptionRule = {
  id: 'quickback_after_reveal',
  area: 'content',
  effort: 2,
  actions: ['fix', 'test', 'ticket'],
  thresholds: { minRouteSessions: 50, minShare: 0.15 },
  acceptance: { metric: 'quickback_rate', direction: 'down', minVisits: 200 },
  detect(agg) {
    const t = this.thresholds;
    return issuesOver(agg, 'quickback', t.minRouteSessions!, t.minShare!).map((issue) => issueFinding(this, agg, issue));
  },
};

const excessiveScrollMissingInfo: PrescriptionRule = {
  id: 'excessive_scroll_missing_info',
  area: 'content',
  effort: 2,
  actions: ['fix', 'ticket'],
  thresholds: { minRouteSessions: 50, minShare: 0.1 },
  acceptance: { metric: 'excessive_scroll_rate', direction: 'down', minVisits: 200 },
  detect(agg) {
    const t = this.thresholds;
    return issuesOver(agg, 'excessive_scroll', t.minRouteSessions!, t.minShare!).map((issue) => issueFinding(this, agg, issue));
  },
};

const deviceGap: PrescriptionRule = {
  id: 'device_gap',
  area: 'site',
  effort: 3,
  actions: ['fix', 'ticket'],
  thresholds: { minSessions: 100, minDesktopConversions: 5, maxRatio: 0.5 },
  acceptance: { metric: 'phone_conversion_rate', direction: 'up', minVisits: 500 },
  detect(agg) {
    const t = this.thresholds;
    const phone = agg.devices.find((d) => d.value === 'phone');
    const desktop = agg.devices.find((d) => d.value === 'desktop');
    if (!phone || !desktop || phone.sessions < t.minSessions! || desktop.sessions < t.minSessions!) return [];
    if (desktop.conversions < t.minDesktopConversions!) return [];
    if (rate(phone) >= t.maxRatio! * rate(desktop)) return [];
    return [{
      ruleId: this.id,
      area: this.area,
      subjectKey: 'device:phone',
      pagePath: null,
      params: { phoneRate: pct(rate(phone)), desktopRate: pct(rate(desktop)), sessions: phone.sessions },
      evidence: [],
      issueId: null,
      fingerprint: null,
      selector: null,
      label: null,
      affected: phone.sessions,
      cohorts: {
        with: { visits: phone.sessions, conversions: phone.conversions },
        without: { visits: desktop.sessions, conversions: desktop.conversions },
        estimated: false,
      },
    }];
  },
};

const releaseRegression: PrescriptionRule = {
  id: 'release_regression',
  area: 'site',
  effort: 1,
  actions: ['fix', 'ticket'],
  // `minDropPoints`: the conversion rate fell by at least this many points, as a
  // percentage of the previous release's rate (10 → a 3.0% site falling to ≤2.7%).
  thresholds: { minSessions: 100, minDropPoints: 10 },
  acceptance: { metric: 'conversion_rate', direction: 'up', minVisits: 500 },
  detect(agg) {
    const t = this.thresholds;
    const [current, previous] = agg.releases;
    if (!current || !previous || current.sessions < t.minSessions! || previous.sessions < t.minSessions!) return [];
    const before = rate(previous);
    if (before <= 0) return [];
    const dropPoints = ((before - rate(current)) / before) * 100;
    if (dropPoints < t.minDropPoints!) return [];
    return [{
      ruleId: this.id,
      area: this.area,
      subjectKey: `release:${current.releaseKey}`,
      pagePath: null,
      params: {
        release: current.label ?? current.releaseKey,
        previous: previous.label ?? previous.releaseKey,
        before: pct(before),
        after: pct(rate(current)),
        drop: Math.round(dropPoints * 10) / 10,
      },
      evidence: [],
      issueId: null,
      fingerprint: null,
      selector: null,
      label: null,
      affected: current.sessions,
      cohorts: {
        with: { visits: current.sessions, conversions: current.conversions },
        without: { visits: previous.sessions, conversions: previous.conversions },
        estimated: false,
      },
    }];
  },
};

function knownCohortRule(id: string, kind: 'pricing' | 'checkout', minNotConverted: number): PrescriptionRule {
  return {
    id,
    area: 'sales',
    effort: 1,
    actions: ['follow_up', 'ticket'],
    thresholds: { minNotConverted },
    acceptance: { metric: 'known_conversion_rate', direction: 'up', minVisits: 20 },
    detect(agg) {
      return agg.knownCohorts
        .filter((c) => c.kind === kind && c.identifiedVisitors - c.convertedVisitors >= minNotConverted)
        .map((c): Finding => ({
          ruleId: id,
          area: 'sales',
          subjectKey: `${kind}:${c.route}`.slice(0, 400),
          pagePath: c.route,
          params: { route: c.route, visitors: c.identifiedVisitors - c.convertedVisitors },
          evidence: evidenceOf(c.recordingIds),
          issueId: null,
          fingerprint: null,
          selector: null,
          label: null,
          affected: c.identifiedVisitors - c.convertedVisitors,
          cohorts: null,
        }));
    },
  };
}

const objectionPattern: PrescriptionRule = {
  id: 'objection_pattern',
  area: 'sales',
  effort: 2,
  actions: ['ticket', 'follow_up'],
  thresholds: { minExamples: 2 },
  acceptance: { metric: 'conversion_rate', direction: 'up', minVisits: 500 },
  detect(agg) {
    return agg.patterns
      .filter((p) => p.examples.length >= this.thresholds.minExamples! && OBJECTION_WORDS.test(p.text))
      .map((p): Finding => ({
        ruleId: this.id,
        area: this.area,
        subjectKey: `objection:${stableHash(p.text.toLowerCase().replace(/\s+/g, ' ').trim())}`,
        pagePath: null,
        params: { pattern: p.text.slice(0, 160), examples: p.examples.length },
        evidence: p.examples.slice(0, EVIDENCE_MAX),
        issueId: null,
        fingerprint: null,
        selector: null,
        label: null,
        affected: p.examples.length,
        cohorts: null,
      }));
  },
};

const proofMissedReason: PrescriptionRule = {
  id: 'proof_missed_reason',
  area: 'funnel',
  effort: 2,
  actions: ['fix', 'ticket'],
  thresholds: { minShare: 0.05, minRouteSessions: 30 },
  acceptance: { metric: 'proof_metric', direction: 'up', minVisits: 200 },
  detect(agg) {
    const t = this.thresholds;
    const reason = [...agg.issues]
      .filter((i) => i.share >= t.minShare! && i.routeSessions >= t.minRouteSessions!)
      .sort((a, b) => b.sessions - a.sessions)[0];
    if (!reason) return [];
    return agg.proofs.filter((p) => p.verdict === 'missed').map((proof): Finding => ({
      ...issueFinding(this, agg, reason, {
        params: {
          proof: proof.title,
          metric: proof.metricLabel ?? '',
          value: proof.metricValue ?? '',
          target: proof.target ?? '',
          reason: reason.title,
        },
      }),
      subjectKey: `proof:${proof.realizationId}`,
    }));
  },
};

/** Every rule, in display order. */
export const PRESCRIPTION_RULES: readonly PrescriptionRule[] = [
  rageOnElement,
  errorOnStep,
  deadClickHeading,
  ctaBelowFold,
  quickbackAfterReveal,
  excessiveScrollMissingInfo,
  deviceGap,
  releaseRegression,
  knownCohortRule('pricing_hesitation', 'pricing', 3),
  knownCohortRule('checkout_abandon_known', 'checkout', 2),
  objectionPattern,
  proofMissedReason,
  ...PAGE_PRESCRIPTION_RULES,
];

export const PRESCRIPTION_RULE_BY_ID: ReadonlyMap<string, PrescriptionRule> = new Map(PRESCRIPTION_RULES.map((r) => [r.id, r]));

/** Run every rule over one site. A rule that throws is a bug in the rule, not the site: it is skipped. */
export function detectFindings(agg: SiteAggregates, rules: readonly PrescriptionRule[] = PRESCRIPTION_RULES): Finding[] {
  return rules.flatMap((rule) => {
    try {
      return rule.detect(agg);
    } catch {
      return [];
    }
  });
}
