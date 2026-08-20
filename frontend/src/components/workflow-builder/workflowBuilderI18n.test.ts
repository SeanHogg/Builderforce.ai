import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { i18nSlug, isRoutedCatalogString, configFieldLabel, configFieldPlaceholder, integrationDescription, integrationOperationLabel } from './workflowBuilderI18n';
import { I18N_NODE_KIND_SLUG, NODE_GROUPS, NODE_GROUP_KEYS, NODE_KINDS } from './nodeKinds';
import { INTEGRATION_CATEGORIES, INTEGRATION_CATEGORY_KEYS, INTEGRATIONS } from './integrations';

const LOCALES = ['en', 'zh', 'es', 'fr', 'de'] as const;

function messages(locale: string): Record<string, unknown> {
  const file = join(__dirname, '..', '..', 'i18n', 'messages', `${locale}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function catalog(locale: string): Record<string, Record<string, string>> {
  return messages(locale).workflowBuilder as Record<string, Record<string, string>>;
}

/** The `evermindBuild` namespace, where the node-kind half's strings live. */
function evermindBuild(locale: string): Record<string, Record<string, unknown>> {
  return messages(locale).evermindBuild as Record<string, Record<string, unknown>>;
}

/**
 * The whole point of deriving the key from the English text is that a NEW field
 * or preset gets a key automatically — and therefore silently ships English into
 * four locales unless something asserts the catalogs are total. This is that
 * something.
 */
describe('workflow-builder catalog strings', () => {
  const wanted = {
    field: [...new Set(NODE_KINDS.flatMap((kind) => kind.fields.map((field) => field.label)))].filter(isRoutedCatalogString),
    placeholder: [...new Set(NODE_KINDS.flatMap((kind) => kind.fields.map((field) => field.placeholder).filter((value): value is string => !!value)))].filter(isRoutedCatalogString),
    integrationDescription: [...new Set(INTEGRATIONS.map((integration) => integration.description))].filter(isRoutedCatalogString),
    operation: [...new Set(INTEGRATIONS.flatMap((integration) => integration.operations.map((operation) => operation.label)))].filter(isRoutedCatalogString),
  };

  it('carries every catalog string in all five locales', () => {
    for (const locale of LOCALES) {
      const messages = catalog(locale);
      for (const [group, strings] of Object.entries(wanted)) {
        const missing = strings
          .map((text) => i18nSlug(text))
          .filter((key) => typeof messages[group]?.[key] !== 'string');
        expect(missing, `${locale}.${group}`).toEqual([]);
      }
    }
  });

  it('translates rather than copying English — the four non-English catalogs differ', () => {
    // A copied catalog passes the totality test above and is the exact failure
    // the localization rule names. Proper nouns and code examples legitimately
    // match, so this asserts a MAJORITY differ, not every row.
    const english = catalog('en');
    for (const locale of LOCALES.filter((value) => value !== 'en')) {
      const messages = catalog(locale);
      for (const group of ['field', 'integrationDescription', 'operation']) {
        const rows = Object.keys(english[group]!);
        const different = rows.filter((key) => messages[group]?.[key] !== english[group]?.[key]);
        expect(different.length / rows.length, `${locale}.${group}`).toBeGreaterThan(0.9);
      }
    }
  });

  it('advertises no superseded model id', () => {
    // The placeholders taught people to type an exact model pin; a stale one
    // teaches them to pin something that no longer routes.
    const placeholders = NODE_KINDS.flatMap((kind) => kind.fields.map((field) => field.placeholder ?? ''));
    expect(placeholders.filter((value) => value.includes('claude-opus-4-8'))).toEqual([]);
    expect(placeholders.filter((value) => value.includes('gpt-4o'))).toEqual([]);
  });

  it('falls back to the English source when a key is absent', () => {
    const t = ((key: string) => { throw new Error(`missing: ${key}`); }) as (key: string) => string;
    expect(configFieldLabel(t, 'Some New Field')).toBe('Some New Field');
    expect(configFieldPlaceholder(t, 'e.g. thing')).toBe('e.g. thing');
    expect(configFieldPlaceholder(t, undefined)).toBeUndefined();
    expect(integrationDescription(t, 'A preset.')).toBe('A preset.');
    expect(integrationOperationLabel(t, 'Do a thing')).toBe('Do a thing');
  });

  it('leaves a rich-text-hostile literal out of the catalog entirely', () => {
    // `<year>` reads as an unclosed rich-text tag to next-intl, which makes the
    // whole message invalid — so the regex example is not routed at all.
    expect(isRoutedCatalogString('e.g. (?<year>x)')).toBe(false);
    expect(isRoutedCatalogString('Send email')).toBe(true);
    const t = ((key: string) => `translated:${key}`) as (key: string) => string;
    expect(configFieldPlaceholder(t, 'e.g. (?<year>x)')).toBe('e.g. (?<year>x)');
  });

  it('derives a stable, collision-free key', () => {
    expect(i18nSlug('Model (blank = default)')).toBe('modelBlankDefault');
    expect(i18nSlug('Send SMS')).toBe('sendSms');
    expect(i18nSlug('')).toBe('untitled');
    const all = Object.values(wanted).flatMap((strings) => strings.map((text) => i18nSlug(text)));
    // Collisions inside ONE group would make two strings share a translation.
    for (const strings of Object.values(wanted)) {
      const keys = strings.map((text) => i18nSlug(text));
      expect(new Set(keys).size, 'collision within a group').toBe(keys.length);
    }
    expect(all.length).toBeGreaterThan(400);
  });
});

/**
 * The node-kind half declares its slugs by hand in {@link I18N_NODE_KIND_SLUG},
 * and the same for the palette's group rail ({@link NODE_GROUP_KEYS}) and the
 * integration rail ({@link INTEGRATION_CATEGORY_KEYS}).
 *
 * A hand-written slug map has a failure the derived keys above cannot have: the
 * map can name a key the catalog never gained. `nodeKindLabel` then returns
 * `t('nodeKind.<slug>.label')`, and next-intl renders the DOTTED PATH — so the
 * step is called `evermindBuild.nodeKind.trigger.label` in the palette, in every
 * language including English. That is exactly how this shipped: the map was
 * completed to all 57 kinds while 26 of them were never added to any catalog.
 * These assertions are what make the map's totality mean something.
 */
describe('workflow-builder hand-declared slug maps', () => {
  it('resolves every node kind’s label and blurb in all five locales', () => {
    const slugs = NODE_KINDS.map((kind) => I18N_NODE_KIND_SLUG[kind.kind]);
    expect(slugs.filter((slug) => !slug), 'kind with no slug').toEqual([]);
    for (const locale of LOCALES) {
      const nodeKind = evermindBuild(locale).nodeKind as Record<string, { label?: string; blurb?: string }>;
      const missing = slugs.filter((slug) => typeof nodeKind?.[slug!]?.label !== 'string' || typeof nodeKind?.[slug!]?.blurb !== 'string');
      expect(missing, `${locale}.nodeKind`).toEqual([]);
    }
  });

  it('resolves every palette group and integration category in all five locales', () => {
    for (const locale of LOCALES) {
      const ns = evermindBuild(locale);
      const groups = NODE_GROUPS.map((group) => NODE_GROUP_KEYS[group]);
      expect(groups.filter((key) => typeof (ns.nodeGroup as Record<string, string>)?.[key] !== 'string'), `${locale}.nodeGroup`).toEqual([]);
      const categories = INTEGRATION_CATEGORIES.map((category) => INTEGRATION_CATEGORY_KEYS[category.id]);
      expect(categories.filter((key) => !key || typeof (ns.integrationCategory as Record<string, string>)?.[key] !== 'string'), `${locale}.integrationCategory`).toEqual([]);
    }
  });

  it('translates the node kinds rather than copying English', () => {
    const en = evermindBuild('en').nodeKind as Record<string, { label: string; blurb: string }>;
    const slugs = Object.keys(en);
    for (const locale of LOCALES.filter((value) => value !== 'en')) {
      const nodeKind = evermindBuild(locale).nodeKind as Record<string, { label: string; blurb: string }>;
      // Blurbs are whole sentences: a matching one is a copy, not a cognate.
      const copied = slugs.filter((slug) => nodeKind[slug]?.blurb === en[slug]?.blurb);
      expect(copied.length / slugs.length, `${locale}.nodeKind.blurb`).toBeLessThan(0.05);
    }
  });
});
