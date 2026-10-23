import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';
import { LOCALES, type Locale } from '@/i18n/config';
import { METRIC_LABEL_KEY, TONE_LABEL_KEY } from './costMetricFormat';
import { GROUPING_LABEL_KEY } from './CostGroupBreakdown';
import { BUDGET_SOURCE_LABEL_KEY, CONTEXT_CATEGORY_LABEL_KEY, TOKEN_PART_LABEL_KEY } from '@/components/agent/RunCostBreakdownView';

/**
 * The cost-efficiency surfaces resolve labels through key registries (metric, tone,
 * grouping, token part, context category), which the literal-call key guard cannot
 * see. Every referenced key must exist — as a string — in every locale catalog.
 */
const CATALOGS: Record<Locale, Record<string, unknown>> = { en, zh, es, fr, de } as never;

const KEYS = [
  ...[METRIC_LABEL_KEY, TONE_LABEL_KEY, GROUPING_LABEL_KEY, TOKEN_PART_LABEL_KEY, CONTEXT_CATEGORY_LABEL_KEY, BUDGET_SOURCE_LABEL_KEY]
    .flatMap((registry) => Object.values(registry))
    .map((key) => `insights.cost.${key}`),
  'insights.aihub.panel.costEfficiency',
  'insights.aihub.panel.costEfficiencyDesc',
  'components.title.aiHubCostEfficiency',
  'components.desc.aiHubCostEfficiencyDesc',
];

function lookup(catalog: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), catalog);
}

describe('cost-efficiency label registries', () => {
  for (const locale of LOCALES) {
    it(`resolve every key in ${locale}`, () => {
      const missing = KEYS.filter((key) => typeof lookup(CATALOGS[locale], key) !== 'string');
      expect(missing).toEqual([]);
    });
  }
});
