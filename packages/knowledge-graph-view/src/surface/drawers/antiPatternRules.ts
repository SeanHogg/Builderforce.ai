/**
 * What each anti-pattern kind means, as DATA: one row per kind with the catalog keys of its reason
 * ("why it is bad"), of "good looks like" and of the "after" description, plus the picture that
 * explains it. A new kind is a new row (and its three sentences in the catalog), never a branch in
 * a component; any kind without a row reads the generic one.
 */

import type { KnowledgeGraphLabels } from '../../labels';
import type { PatternsRuleKey } from '../../labels/surface.patterns';
import { fillTemplate } from '../../labels';

/** `layerArrow`: two layers and the link that climbs; `measures`: a file against its size limits; `none`: no picture. */
export type DiagramId = 'layerArrow' | 'measures' | 'none';

export interface AntiPatternRule {
    kind: string;
    reasonKey: PatternsRuleKey;
    goodKey: PatternsRuleKey;
    afterKey: PatternsRuleKey;
    diagram: DiagramId;
}

export const ANTI_PATTERN_RULES: readonly AntiPatternRule[] = [
    { kind: 'partition-violation', reasonKey: 'partitionViolationReason', goodKey: 'partitionViolationGood', afterKey: 'partitionViolationAfter', diagram: 'layerArrow' },
    { kind: 'god-module', reasonKey: 'godModuleReason', goodKey: 'godModuleGood', afterKey: 'godModuleAfter', diagram: 'measures' },
];

export const GENERIC_RULE: AntiPatternRule = { kind: '*', reasonKey: 'genericReason', goodKey: 'genericGood', afterKey: 'genericAfter', diagram: 'none' };

const BY_KIND: ReadonlyMap<string, AntiPatternRule> = new Map(ANTI_PATTERN_RULES.map((r) => [r.kind, r]));

export const ruleOf = (kind: string): AntiPatternRule => BY_KIND.get(kind) ?? GENERIC_RULE;

/** The rule's three sentences, filled with the layer names of the finding (`{from}`, `{to}`). */
export function ruleText(kind: string, labels: KnowledgeGraphLabels, params: Record<string, string | undefined> = {}): { reason: string; good: string; after: string } {
    const rule = ruleOf(kind), r = labels.surface.patterns.rules;
    return { reason: fillTemplate(r[rule.reasonKey], params), good: fillTemplate(r[rule.goodKey], params), after: fillTemplate(r[rule.afterKey], params) };
}
