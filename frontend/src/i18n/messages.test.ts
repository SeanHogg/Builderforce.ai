import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import en from './messages/en.json';
import zh from './messages/zh.json';
import es from './messages/es.json';
import fr from './messages/fr.json';
import de from './messages/de.json';
import { LOCALES, DEFAULT_LOCALE, type Locale } from './config';
import { STALL_CAUSES } from '@/lib/builderforceApi';
import { CREATION_OBJECT_REGISTRY } from '@/components/creation-canvas/creationObjectRegistry';
import {
  FOOTER_COLUMNS,
  LEARN_COLUMNS,
  PRODUCT_COLUMNS,
  PRODUCT_STAGES,
  productFacesFor,
  NAV_GROUPS,
  FOR_HIRE_NAV_GROUPS,
  FREELANCER_NAV_GROUPS,
  PUBLIC_DESTINATIONS,
  SALES_NAV_GROUPS,
  STAGES,
  bottomNavFor,
  destTaglineKey,
  destTitleKey,
} from '@/lib/navGroups';
import { FAMILIES, FAMILY_IDS } from '@/lib/marketplaceFamilies';

import { listWidgets } from '@/lib/widgets/registry';
import { AI_INSIGHT_PANELS } from '@/components/insights/aiInsightPanels';
import { DELIVERY_PANELS } from '@/components/insights/deliveryPanels';
import { DEVEX_PANELS } from '@/components/insights/devexPanels';
import { FINANCE_PANELS } from '@/components/insights/finance/financePanels';

/** Both mega-menus' columns — every one needs a heading, every row in one needs
 *  a tagline. */
const MENU_COLUMNS = [...PRODUCT_COLUMNS, ...LEARN_COLUMNS];

/**
 * Catalog guard for the five message files.
 *
 * Two failure modes had no test and both render the same way in the product —
 * as the raw dotted key, in the middle of the UI:
 *
 *  1. A key added to `en.json` and not to the other four. The localize-in-the-
 *     same-pass rule says every string ships translated; nothing enforced it.
 *  2. A message whose ICU syntax is malformed (an unclosed `{`, a plural with no
 *     `other` arm). next-intl swallows the format error and falls back to the key,
 *     so a broken message looks exactly like a missing one and passes every other
 *     test in the suite.
 *
 * This asserts BOTH across every catalog: identical key sets, and every message
 * actually formatting to something that is not its own key.
 */

const CATALOGS: Record<Locale, Record<string, unknown>> = { en, zh, es, fr, de } as never;

type Leaf = { path: string; message: string };

/** Flatten a catalog to dotted leaf paths, ignoring non-string leaves. */
function leaves(obj: Record<string, unknown>, prefix = ''): Leaf[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) return leaves(v as Record<string, unknown>, path);
    return typeof v === 'string' ? [{ path, message: v }] : [];
  });
}

/**
 * The arguments a SPECIFIC message needs, read off its own placeholders.
 *
 * A generic catch-all bag does not work — next-intl throws on a missing argument,
 * so a message's values have to be derived from the message itself. Every argument
 * gets the number 2: valid for plain interpolation and for `plural`/`selectordinal`
 * alike (a `select` with no matching arm falls back to its `other`).
 */
function argsFor(message: string): Record<string, number> {
  const args: Record<string, number> = {};
  for (const [, name] of message.matchAll(/\{\s*([a-zA-Z_]\w*)\s*[,}]/g)) args[name] = 2;
  return args;
}

/** Rich messages carry `<tag>` markup and must be formatted through `t.rich`. */
const hasTags = (message: string): boolean => /<[a-zA-Z]\w*>/.test(message);

const QUICK_START_KEYS = [
  'sectionTitle',
  'modeOneliner',
  'modeHackable',
  'change',
  'beta',
  'copyCommandAria',
  'macosTagline',
  'macosSubtitle',
  'macosDownload',
  'macosMeta',
  'note',
] as const;

const CREATION_CANVAS_TOUR_CONTROL_KEYS = [
  'back',
  'next',
  'startCreating',
  'tourCancel',
  'tourClose',
] as const;

/** Tag handlers for `t.rich` — every tag renders its chunks unchanged. */
const tagsFor = (message: string): Record<string, (chunks: unknown) => unknown> =>
  Object.fromEntries(
    [...message.matchAll(/<([a-zA-Z]\w*)>/g)].map(([, tag]) => [tag, (chunks: unknown) => chunks]),
  );

describe('message catalogs', () => {
  const enPaths = leaves(en as Record<string, unknown>).map((l) => l.path);

  it.each(LOCALES)('%s has every QuickStart message', (locale) => {
    const quickStart = CATALOGS[locale].quickStart as Record<string, unknown> | undefined;
    expect(quickStart).toBeDefined();
    expect(Object.keys(quickStart ?? {}).sort()).toEqual([...QUICK_START_KEYS].sort());
  });

  it.each(LOCALES)('%s labels every manager stall cause', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale] });
    const missing = STALL_CAUSES.filter((cause) => {
      const key = `manager.stalls.cause.${cause}`;
      return t(key as never) === key;
    });
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)('%s labels every creation canvas object kind', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale] });
    const missing = CREATION_OBJECT_REGISTRY
      .map(({ kind }) => kind)
      .filter((kind) => t(`creationCanvas.object.${kind}` as never) === `creationCanvas.object.${kind}`);
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)('%s labels every creation canvas tour control', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale] });
    const missing = CREATION_CANVAS_TOUR_CONTROL_KEYS.filter((control) => {
      const key = `creationCanvas.${control}`;
      return t(key as never) === key;
    });
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)('%s resolves every registry-backed localization key', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale], onError: () => {} });
    const navGroups = [...NAV_GROUPS, ...FOR_HIRE_NAV_GROUPS, ...FREELANCER_NAV_GROUPS, ...SALES_NAV_GROUPS];
    const bottomNav = [
      ...bottomNavFor(false, false),
      ...bottomNavFor(true, false),
      ...bottomNavFor(true, true),
      ...bottomNavFor(true, false, true),
      ...bottomNavFor(true, false, false, true),
    ];
    const familyKeys = FAMILY_IDS.flatMap((id) => {
      const family = FAMILIES[id];
      return [family.labelKey, family.publishKey, family.noteKey, ...family.kinds.map((kind) => `kind.${kind}`)]
        .map((key) => `marketplace.family.${key}`);
    });
    const panelKeys = [
      ...Object.values(AI_INSIGHT_PANELS).flatMap((panel) => [`insights.aihub.${panel.titleKey}`, `insights.aihub.${panel.descKey}`]),
      ...Object.values(DELIVERY_PANELS).flatMap((panel) => [`insights.delivhub.${panel.titleKey}`, `insights.delivhub.${panel.descKey}`]),
      ...Object.values(DEVEX_PANELS).flatMap((panel) => [`insights.devexhub.${panel.titleKey}`, `insights.devexhub.${panel.descKey}`]),
      ...FINANCE_PANELS.flatMap((panel) => [`insights.${panel.titleKey}`, `insights.${panel.subtitleKey}`]),
    ];
    const keys = new Set([
      // Every public destination's title, and a tagline for the ones a mega-menu
      // column renders. This is the assertion that would have caught the Learn
      // menu shipping without one.
      ...PUBLIC_DESTINATIONS.map((entry) => destTitleKey(entry)),
      ...PUBLIC_DESTINATIONS.filter((entry) => MENU_COLUMNS.includes(entry.placement as never)).map(destTaglineKey),
      ...LEARN_COLUMNS.map((column) => `marketingNav.column.${column}`),
      // The Product menu IS the rail, so every rail row it shows needs a name
      // (the rail's own) and a one-liner (its explainer's, or its own).
      ...PRODUCT_STAGES.flatMap((stage) => [
        `nav.stage.${stage}`,
        ...productFacesFor(stage).flatMap((face) => [`nav.${face.titleKey}`, face.taglineKey]),
      ]),
      ...PUBLIC_DESTINATIONS.flatMap((entry) =>
        (entry.sections ?? []).map((section) => `referencePanel.section.${section.labelKey}`)),
      'marketingNav.megaFoot',
      'marketingNav.megaFootLearn',
      // `referencePanel.crumb` is deliberately absent: it takes a `{seat}`
      // argument, and this list formats with none. The every-message-formats
      // test below covers it, deriving arguments from the message itself.
      ...navGroups.flatMap((group) => [
        `nav.${group.labelKey}`,
        ...(group.tabs ?? []).map((tab) => `nav.${tab.labelKey}`),
      ]),
      ...bottomNav.map(({ labelKey }) => `nav.${labelKey}`),
      ...STAGES.flatMap((stage) => [`nav.stage.${stage}`, `featuresPage.arcQuestion.${stage}`]),
      ...['domains', 'seats', 'destinations', 'features'].map((stat) => `featuresPage.stat.${stat}`),
      ...FOOTER_COLUMNS.map((column) => `footer.${column.titleKey}`),
      ...familyKeys,
      ...listWidgets().flatMap(({ titleKey, group }) => [`widgets.title.${titleKey}`, `widgets.group.${group}`]),
      ...panelKeys,
    ]);
    const missing = [...keys].filter((key) => t(key as never) === key).sort();
    expect(missing).toEqual([]);
  });

  it.each(LOCALES.filter((l) => l !== DEFAULT_LOCALE))('%s has exactly the keys en has', (locale) => {
    const paths = new Set(leaves(CATALOGS[locale]).map((l) => l.path));
    const missing = enPaths.filter((p) => !paths.has(p));
    const extra = [...paths].filter((p) => !enPaths.includes(p));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it.each(LOCALES)('%s: every message formats instead of falling back to its key', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale], onError: () => {} });
    const broken: string[] = [];
    for (const { path, message } of leaves(CATALOGS[locale])) {
      let out: string;
      try {
        out = hasTags(message)
          ? String(t.rich(path as never, { ...argsFor(message), ...tagsFor(message) } as never))
          : String(t(path as never, argsFor(message) as never));
      } catch {
        broken.push(path);
        continue;
      }
      // next-intl returns the key path verbatim when a message is missing or its
      // ICU fails to parse — the exact symptom this guards against.
      if (out === path) broken.push(path);
    }
    expect(broken).toEqual([]);
  });
});
