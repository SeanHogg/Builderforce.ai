import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';
import { LOCALES, type Locale } from '@/i18n/config';
import { COST_GROUPINGS } from '@/lib/costMetricsApi';
import { GROUPING_LABEL_KEY, ROUTE_LABEL_KEY } from './CostGroupBreakdown';

/** The pipeline-route group names (`full` / `quick`) and the model / route groupings are
 *  labelled in every locale. */
const CATALOGS: Record<Locale, Record<string, unknown>> = { en, zh, es, fr, de } as never;

function lookup(catalog: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), catalog);
}

describe('cost groupings — model and pipeline route', () => {
  it('offers both groupings', () => {
    expect(COST_GROUPINGS).toContain('model');
    expect(COST_GROUPINGS).toContain('route');
  });

  for (const locale of LOCALES) {
    it(`labels the route groups in ${locale}`, () => {
      const keys = [...Object.values(ROUTE_LABEL_KEY), GROUPING_LABEL_KEY.model, GROUPING_LABEL_KEY.route].map((k) => `insights.cost.${k}`);
      expect(keys.filter((k) => typeof lookup(CATALOGS[locale], k) !== 'string')).toEqual([]);
    });
  }
});
