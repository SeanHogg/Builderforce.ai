// @vitest-environment node
/**
 * src/surface/drawers/antiPatternRules.i18n.test.ts — every anti-pattern rule row's three sentences
 * (and the generic fallback's) are translated in every catalog, and every row's kind has a finding
 * label and a fix request.
 */

import { describe, expect, it } from 'vitest';
// `?raw` imports, as `repoConfigName.test.ts` reads the catalogs: `new URL(..., import.meta.url)` makes Vite treat the JSON as an asset (`?url`) outside fs.allow.
import de from '../../../../../frontend/src/i18n/messages/de.json?raw';
import en from '../../../../../frontend/src/i18n/messages/en.json?raw';
import es from '../../../../../frontend/src/i18n/messages/es.json?raw';
import fr from '../../../../../frontend/src/i18n/messages/fr.json?raw';
import zh from '../../../../../frontend/src/i18n/messages/zh.json?raw';
import { ANTI_PATTERN_RULES, GENERIC_RULE } from './antiPatternRules';

const LOCALES = ['en', 'de', 'es', 'fr', 'zh'] as const;
const CATALOGS: Record<(typeof LOCALES)[number], string> = { en, de, es, fr, zh };
const camel = (kind: string) => kind.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

interface KnowledgeGraphCatalog {
    findingKinds: Record<string, string>;
    fix: Record<string, string>;
    surface: { patterns: { rules: Record<string, string> } };
}

describe('anti-pattern rule copy', () => {
    for (const lang of LOCALES) {
        it(`${lang} translates every rule row`, () => {
            const raw = CATALOGS[lang];
            const kg = (JSON.parse(raw) as { knowledgeGraph: KnowledgeGraphCatalog }).knowledgeGraph;
            for (const rule of [...ANTI_PATTERN_RULES, GENERIC_RULE]) {
                for (const key of [rule.reasonKey, rule.goodKey, rule.afterKey]) {
                    expect(kg.surface.patterns.rules[key], `${lang}: ${key}`).toBeTruthy();
                }
            }
            for (const rule of ANTI_PATTERN_RULES) {
                expect(kg.findingKinds[camel(rule.kind)], `${lang}: findingKinds.${camel(rule.kind)}`).toBeTruthy();
                expect(kg.fix[camel(rule.kind)], `${lang}: fix.${camel(rule.kind)}`).toBeTruthy();
            }
        });
    }
});
