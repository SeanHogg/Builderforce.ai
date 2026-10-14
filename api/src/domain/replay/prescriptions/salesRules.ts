/**
 * The SALES prescription rules (PRD 33 §5.1.1, D13) — data, pure, part of
 * `PRESCRIPTION_RULES` (`rules.ts` assembles the list, in display order).
 *
 *   • `pricing_hesitation` / `checkout_abandon_known` — identified visitors who
 *     reached pricing / checkout and did not convert (a follow-up, not a fix);
 *   • `objection_pattern` — a recurring free-text pattern that names an objection.
 */

import { EVIDENCE_MAX, evidenceOf, stableHash } from './ruleEvidence';
import type { Finding, PrescriptionRule } from './types';

const OBJECTION_WORDS = /\b(price|pricing|expensive|cost|fee|trust|secur|privacy|shipping|delivery|refund|return|compar|hesitat|unclear|confus|doubt|risk|contract|cancel)/i;

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

export const objectionPattern: PrescriptionRule = {
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

export const pricingHesitation: PrescriptionRule = knownCohortRule('pricing_hesitation', 'pricing', 3);
export const checkoutAbandonKnown: PrescriptionRule = knownCohortRule('checkout_abandon_known', 'checkout', 2);
