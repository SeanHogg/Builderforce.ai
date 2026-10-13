import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPLAY_PRESCRIPTION_AREAS,
  REPLAY_PRESCRIPTION_ROUTE_ACTIONS,
} from '@builderforce/interaction-contract';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';
import { PRESCRIPTION_ACTION_UI } from './prescriptionActionUi';

/**
 * The fix card renders a finding's title from `replay.prescription.rule.<ruleId>`
 * — keys finished at runtime, which `check:i18n-keys` cannot see. This proves
 * them by enumerating the registries that supply the suffixes: every rule id in
 * the API's `PRESCRIPTION_RULES` (read from its source — the domain is not a
 * frontend dependency), every area, status and route action, in all five catalogs.
 */

const RULES_SOURCE = resolve(__dirname, '../../../../../api/src/domain/replay/prescriptions/rules.ts');

function ruleIds(): string[] {
  const source = readFileSync(RULES_SOURCE, 'utf8');
  const literal = [...source.matchAll(/^\s+id: '([a-z_]+)',\r?$/gm)].map((m) => m[1]!);
  const factory = [...source.matchAll(/knownCohortRule\('([a-z_]+)'/g)].map((m) => m[1]!);
  return [...literal, ...factory];
}

type Catalog = Record<string, unknown>;
const CATALOGS: Record<string, Catalog> = { en, zh, es, fr, de };

function at(catalog: Catalog, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Catalog)[part] : undefined), catalog);
}

const STATUSES = ['proposed', 'applied', 'measuring', 'worked', 'no_effect', 'worse', 'dismissed'];

describe('prescription catalog', () => {
  const ids = ruleIds();

  it('finds every rule of PRESCRIPTION_RULES', () => {
    expect(ids).toEqual(expect.arrayContaining([
      'rage_on_element', 'error_on_step', 'dead_click_heading', 'cta_below_fold', 'quickback_after_reveal',
      'excessive_scroll_missing_info', 'device_gap', 'release_regression', 'pricing_hesitation',
      'checkout_abandon_known', 'objection_pattern', 'proof_missed_reason',
    ]));
  });

  it.each(Object.keys(CATALOGS))('%s titles and describes every rule, area, status and action', (locale) => {
    const catalog = CATALOGS[locale]!;
    const missing: string[] = [];
    const need = (path: string) => { if (typeof at(catalog, path) !== 'string') missing.push(path); };
    for (const id of ids) {
      need(`replay.prescription.rule.${id}.title`);
      need(`replay.prescription.rule.${id}.description`);
    }
    for (const area of REPLAY_PRESCRIPTION_AREAS) need(`replay.prescription.area.${area}`);
    for (const status of STATUSES) need(`replay.prescription.status.${status}`);
    for (const action of REPLAY_PRESCRIPTION_ROUTE_ACTIONS) {
      need(`replay.prescription.actions.${PRESCRIPTION_ACTION_UI[action].labelKey}`);
      if (PRESCRIPTION_ACTION_UI[action].gate === 'confirm') {
        for (const part of ['title', 'message', 'confirm']) need(`replay.prescription.confirm.${action}.${part}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
