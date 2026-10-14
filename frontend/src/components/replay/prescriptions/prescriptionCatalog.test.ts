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

/** The page-review rules (§5.2), appended to `PRESCRIPTION_RULES`. */
const PAGE_RULES_SOURCE = resolve(__dirname, '../../../../../api/src/domain/replay/prescriptions/pageRules.ts');

function pageRuleIds(): string[] {
  const source = readFileSync(PAGE_RULES_SOURCE, 'utf8');
  // `pageRule({ id: 'seo_title_length', area: …` — and the observed row's id constant.
  const literal = [...source.matchAll(/\bid: '([a-z0-9_]+)', area:/g)].map((m) => m[1]!);
  const observed = [...source.matchAll(/OBSERVED_RULE_ID = '([a-z_]+)'/g)].map((m) => m[1]!);
  return [...literal, ...observed];
}

const PAGE_RULE_IDS = [
  'seo_title_length', 'seo_missing_meta_description', 'seo_multiple_h1', 'seo_no_structured_data',
  'seo_low_ctr_high_impressions', 'content_no_value_prop_above_fold', 'content_cta_vague', 'content_readability',
  'content_missing_trust', 'perf_lcp_poor', 'perf_cls_poor', 'perf_heavy_hero_image', 'a11y_contrast',
  'a11y_tap_targets', 'a11y_missing_labels', 'vision_observed',
];

type Catalog = Record<string, unknown>;
const CATALOGS: Record<string, Catalog> = { en, zh, es, fr, de };

function at(catalog: Catalog, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Catalog)[part] : undefined), catalog);
}

const STATUSES = ['proposed', 'applied', 'measuring', 'worked', 'no_effect', 'worse', 'dismissed'];

describe('prescription catalog', () => {
  const ids = [...ruleIds(), ...pageRuleIds()];

  it('finds every page-review rule of PAGE_PRESCRIPTION_RULES', () => {
    expect(pageRuleIds().sort()).toEqual([...PAGE_RULE_IDS].sort());
  });

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
