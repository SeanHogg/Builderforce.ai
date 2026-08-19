import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import en from './messages/en.json';
import zh from './messages/zh.json';
import es from './messages/es.json';
import fr from './messages/fr.json';
import de from './messages/de.json';
import { LOCALES, DEFAULT_LOCALE, type Locale } from './config';
import { STALL_CAUSES } from '@/lib/builderforceApi';
import { CAMPAIGN_BLOCKERS } from '@/lib/growthApi';
import { CREATION_OBJECT_REGISTRY } from '@/components/creation-canvas/creationObjectRegistry';
import { CREATION_TEMPLATES } from '@/components/creation-canvas/creationTemplates';
import {
  NAV_GROUPS,
  FOR_HIRE_NAV_GROUPS,
  FREELANCER_NAV_GROUPS,
  SALES_NAV_GROUPS,
  STAGES,
  bottomNavFor
} from '@/lib/navGroups';
import {
  FOOTER_COLUMNS,
  LEARN_COLUMNS,
  PRODUCT_COLUMNS,
  PRODUCT_STAGES,
  productFacesFor,
  PUBLIC_DESTINATIONS,
  destTaglineKey,
  destTitleKey
} from '@/lib/publicDestinations';
import { COMPARE_ARENAS } from '@/lib/content';
import { FAMILIES, FAMILY_IDS, kindLabelKey } from '@/lib/marketplaceFamilies';
import { BLOG_TOPICS } from '@/lib/blogTopics';
import { METHOD_STEPS, PROOF_FORMS, methodStepKey, proofFormKey } from '@/lib/methodology';
import { destinationPitchKey, teaserDestinationIds } from '@/lib/routeMarketing';
import { RESUME_TEMPLATES } from '@/lib/canvasResume';
import { CANVAS_SESSION_ACTIONS } from '@/lib/canvasSessionActions';
import { OUTCOME_METRIC_FAMILY_ORDER, OUTCOME_METRIC_MESSAGE_KEYS } from '@/lib/outcomeMetrics';

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

  it.each(LOCALES)('%s labels every campaign blocker', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale] });
    const missing = CAMPAIGN_BLOCKERS.filter((blocker) => {
      const key = `growth.campaigns.blocker.${blocker}`;
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

  it.each(LOCALES)('%s labels every resume template', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale] });
    const missing = RESUME_TEMPLATES.filter(({ labelKey }) => {
      const key = `creationCanvas.resumeEditor.${labelKey}`;
      return t(key as never) === key;
    });
    expect(missing).toEqual([]);
  });

  /**
   * The session bar renders from a registry, so its labels never appear as a
   * literal at a `t(…)` call site and `check-i18n-keys.mjs` cannot see them.
   * That is how `prove` shipped: the action was added to the registry, the
   * board rendered `creationCanvas.proveThisIdea` as its button, and both
   * guards stayed green.
   */
  it.each(LOCALES)('%s labels every canvas session action', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale], onError: () => {} });
    const missing = CANVAS_SESSION_ACTIONS
      .flatMap(({ labelKey, activeLabelKey, titleKey }) => [labelKey, activeLabelKey, titleKey])
      .filter((key): key is string => Boolean(key))
      .map((key) => `creationCanvas.${key}`)
      .filter((key) => !t.has(key as never));
    expect(missing).toEqual([]);
  });

  /**
   * The outcome vocabulary is assembled inside `lib/outcomeMetrics.ts`, which
   * falls back to the English on the wire when a key is absent — so a missing
   * entry renders plausible English in every locale rather than a raw key, and
   * no other guard notices. The metric keys themselves are the SERVER's, and a
   * metric this build has not learned is expected; the fixed vocabulary and the
   * families this build does know are not.
   */
  it.each(LOCALES)('%s carries the outcome-metric vocabulary', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale], onError: () => {} });
    const missing = [
      ...OUTCOME_METRIC_MESSAGE_KEYS,
      ...[...OUTCOME_METRIC_FAMILY_ORDER, 'unfiled'].map((family) => `family.${family}`),
    ]
      .map((key) => `outcomeMetrics.${key}`)
      // `has`, not a render: half this vocabulary takes an ICU argument, and
      // formatting it argument-less would report a present key as missing. That
      // the messages FORMAT is already proven, for every leaf, at the bottom of
      // this file.
      .filter((key) => !t.has(key as never));
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)('%s labels every creation canvas template', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale] });
    const missing = CREATION_TEMPLATES.flatMap(({ id }) => ['name', 'description'].map((field) => `creationCanvas.template.${id}.${field}`))
      .filter((key) => t(key as never) === key);
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

  it.each(LOCALES)('%s keeps the Twilio AI journey starter addressable and complete', (locale) => {
    const promptUseCases = CATALOGS[locale].promptUseCases as { items?: Array<Record<string, unknown>> } | undefined;
    const starter = promptUseCases?.items?.find((item) => item.id === 'twilio-ai-journey');
    expect(starter).toMatchObject({ category: 'apps' });
    expect(String(starter?.label || '')).toContain('Twilio');
    expect(String(starter?.prompt || '')).toContain('twilio');
    expect(String(starter?.prompt || '').length).toBeGreaterThan(200);
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
    // A kind chip's label may come from either the family bar's copy or the
    // canvas listing vocabulary, so the key is taken from `kindLabelKey` — the
    // same derivation the storefront renders with — rather than assumed to sit
    // under `marketplace.family.kind.*`.
    const familyKeys = FAMILY_IDS.flatMap((id) => {
      const family = FAMILIES[id];
      return [
        ...[family.labelKey, family.publishKey, family.noteKey].map((key) => `marketplace.family.${key}`),
        ...family.kinds.map(kindLabelKey),
      ];
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
      // The panel's index-rail labels. They are no longer reachable from the
      // registry — a reference page hands `ReferencePage` the same array it
      // renders its anchors from — so the keys are listed here directly. Only
      // the fixed-section pages key their labels in the catalog at all;
      // `/integrations` and the domain explainers label their rail from the copy
      // they are already rendering.
      ...['label', 'report', 'criteria', 'how', 'audits', 'faq', 'start']
        .map((section) => `referencePanel.section.${section}`),
      'marketingNav.megaFoot',
      'marketingNav.megaFootLearn',
      // The logged-out route teaser. Every nav row is a marketing page for a
      // signed-out visitor (`<RouteMarketing>`), and its hero pitch comes from
      // here — so a destination without one renders the generic gate under a
      // real destination's name, in four languages, silently. The generic tier's
      // own copy is asserted alongside it.
      ...teaserDestinationIds().map((id) => `routeMarketing.${destinationPitchKey(id)}`),
      'routeMarketing.generic.title',
      'routeMarketing.generic.description',
      'methodology.youAreHere',
      // `referencePanel.crumb` is deliberately absent: it takes a `{seat}`
      // argument, and this list formats with none. The every-message-formats
      // test below covers it, deriving arguments from the message itself.
      ...navGroups.flatMap((group) => [
        `nav.${group.labelKey}`,
        ...(group.tabs ?? []).map((tab) => `nav.${tab.labelKey}`),
      ]),
      ...bottomNav.map(({ labelKey }) => `nav.${labelKey}`),
      // A stage's NAME is the rail's (`nav.stage.*`); its QUESTION belongs to
      // the methodology registry, which /features' arc table and
      // <MethodologySection> both read — it used to live under `featuresPage`,
      // where a shared component had no business reaching for it.
      ...STAGES.flatMap((stage) => [`nav.stage.${stage}`, `methodology.arcQuestion.${stage}`]),
      // Read → Prove → Build, and the eight proof forms, as rendered on
      // /features, /about, /pricing and /sell-builderforce.
      // `prompt` included: every card is a link into a canvas seeded with it, so
      // a locale missing one opens a blank board for that language only.
      ...METHOD_STEPS.flatMap((step) => (['title', 'question', 'body', 'prompt'] as const).map((f) => `methodology.${methodStepKey(step, f)}`)),
      ...PROOF_FORMS.flatMap(({ key }) => (['name', 'question', 'summary', 'prompt'] as const).map((f) => `methodology.${proofFormKey(key, f)}`)),
      'methodology.cardAction',
      ...['domains', 'seats', 'destinations', 'features'].map((stat) => `featuresPage.stat.${stat}`),
      ...FOOTER_COLUMNS.map((column) => `footer.${column.titleKey}`),
      ...familyKeys,
      // Every blog topic chip's label. The registry is a data table, so a new
      // topic is a row — and a row without a label renders its own dotted key
      // in the filter bar, in five languages.
      ...BLOG_TOPICS.map((topic) => `blog.topic.${topic.labelKey}`),
      // A widget's title, its group heading, and — now that WidgetCard renders it
      // — its optional one-line description. `descKey` had no assertion while it
      // had no consumer, so a widget could declare one the catalogs didn't have.
      ...listWidgets().flatMap(({ titleKey, group, descKey }) => [
        `widgets.title.${titleKey}`,
        `widgets.group.${group}`,
        ...(descKey ? [`widgets.desc.${descKey}`] : []),
      ]),
      ...panelKeys,
      // Every comparison arena's tab label and blurb, and a vendor name for
      // every column in it. `/compare` renders the tab strip straight off
      // COMPARE_ARENAS, so an arena added to the registry without catalog copy
      // would put a dotted key on a tab in five languages.
      ...COMPARE_ARENAS.flatMap((arena) => [
        `compare.arenas.${arena.key}.label`,
        `compare.arenas.${arena.key}.blurb`,
        ...arena.competitors.map((column) => `compare.competitorLabels.${column.key}`),
      ]),
    ]);
    const missing = [...keys].filter((key) => t(key as never) === key).sort();
    expect(missing).toEqual([]);
  });

  /**
   * The matrix is a grid, and a grid drifts one cell at a time: a column added
   * to `COMPARE_ARENAS` with no `values` entry renders a silently empty cell
   * under a vendor's name, which reads as "not supported" rather than as the
   * missing data it is.
   */
  it.each(LOCALES)('%s fills every comparison cell for every arena column', (locale) => {
    const arenas = (CATALOGS[locale].compare as Record<string, unknown>).arenas as Record<
      string,
      {
        categories?: { id: string; rows?: { feature: string; values?: Record<string, string> }[] }[];
        faq?: { question?: string; answer?: string }[];
      }
    >;
    const gaps: string[] = [];
    for (const arena of COMPARE_ARENAS) {
      const categories = arenas?.[arena.key]?.categories ?? [];
      expect(categories.length, `${arena.key} has no categories`).toBeGreaterThan(0);
      // Each tab carries its own FAQ, so a tab without one renders a heading
      // over nothing — `MarketingFaq` self-gates and the section reads empty.
      const faq = arenas?.[arena.key]?.faq ?? [];
      expect(faq.length, `${arena.key} has no faq`).toBeGreaterThan(0);
      for (const item of faq) {
        if (!item.question?.trim() || !item.answer?.trim()) gaps.push(`${arena.key}/faq/${item.question ?? '(no question)'}`);
      }
      const columns = ['builderforce', ...arena.competitors.map((column) => column.key)];
      for (const category of categories) {
        for (const row of category.rows ?? []) {
          for (const column of columns) {
            if (!row.values?.[column]?.trim()) gaps.push(`${arena.key}/${category.id}/${row.feature}/${column}`);
          }
        }
      }
    }
    expect(gaps).toEqual([]);
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
