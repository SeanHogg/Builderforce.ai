import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';
import { localeToBcp47 } from '@/i18n/config';
import type { CanvasCourse } from '@/lib/courseLms';
import { CREATION_TEMPLATES } from './creationTemplates';
import { localizePack, type PackText } from './localizePack';

const CATALOGS = { en, zh, es, fr, de } as Record<string, Record<string, unknown>>;

/** The board's `creationCanvas` translator for a locale — what the canvas hands in. */
function packText(locale: string): PackText {
  const t = createTranslator({ locale, messages: CATALOGS[locale] as never, namespace: 'creationCanvas' as never, onError: () => {} });
  return { text: (key) => t(key as never), has: (key) => t.has(key as never) };
}

/** Every leaf path under `creationCanvas.pack`. */
function packKeys(messages: Record<string, unknown>): string[] {
  const walk = (value: unknown, path: string): string[] => (
    value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, item]) => walk(item, path ? `${path}.${key}` : key))
      : [path]
  );
  return walk((messages.creationCanvas as { pack?: unknown }).pack, '').sort();
}

/**
 * STRINGS A PACK MAY CARRY WITHOUT A CATALOG KEY — identifiers and data, not copy.
 * The registry, the connectors and the renderers match on these values, so
 * translating one would break the card. Anything NOT covered here is user-visible
 * copy and needs a `creationCanvas.pack.<id>` key in all five catalogs.
 */
/** Data keys whose value is an identifier or enum (the nearest non-index key of the path). */
const TOKEN_KEYS = new Set([
  // ids, structure and layout
  'id', 'lane', 'stage', 'stages', 'chart', 'span', 'unit', 'kind', 'ownerUserId',
  // links and files
  'url', 'previewUrl', 'format', 'size',
  // agent seats and engine config
  'agentSeat', 'agentDomain', 'model', 'role',
  // workflow plumbing: connector/action ids, trigger, cron, timezone, approval
  'connector', 'action', 'approvalMode', 'triggerType', 'cron', 'timezone',
  // academic / field-service enum values
  'courseCode', 'deliveryMode', 'assessmentMode', 'grade', 'evidenceHeld', 'timepoint',
  'discipline', 'criticality', 'orderType', 'priority', 'incidentType', 'severity',
  // research data: source names (proper nouns), standards, style ids, versions, language, sort
  'databases', 'exportStandards', 'citationStyle', 'sortOrder', 'version', 'language',
  // field-service enums (`monthly | quarterly | annual | per-visit`), a time range, and
  // proper nouns (a statute title, a registry name)
  'cadence', 'billingCycle', 'arrivalWindow', 'standard', 'issuer',
  // seeded source code is code, not prose
  'code',
]);

/** Exact paths that are proper nouns / acronyms rather than prose. */
const TOKEN_PATHS = new Set([
  'pack.social-growth-campaign.o6.title', // "CMO" — an agent seat acronym
]);

/** A placeholder / empty / numeric / file-slug value: nothing to translate. */
const isInertValue = (value: string) => value === '' || value === '—' || /^[\d.]+$/.test(value);

/** `data.files.N.name` is a file slug ("pdf", "pptx", "slides"), not a label. */
const isFileSlug = (path: string) => /\.data\.files\.\d+\.name$/.test(path);

function isToken(path: string, value: string): boolean {
  if (TOKEN_PATHS.has(path) || isFileSlug(path) || isInertValue(value)) return true;
  if (value.includes('{{')) return true; // `{{placeholder}}` template references
  if (/\.input\./.test(path)) return true; // connector call inputs
  const key = path.split('.').filter((segment) => !/^\d+$/.test(segment)).pop() ?? '';
  return TOKEN_KEYS.has(key);
}

/** The pack minus the minted course, which is built rather than stored. */
const withoutCourse = (objects: ReturnType<typeof localizePack>['objects']) => objects.map(({ worked: _worked, ...object }) => {
  const { course: _course, ...data } = (object.data ?? {}) as Record<string, unknown>;
  return { ...object, ...(object.data ? { data } : {}) };
});

describe('creation packs are placed in the board’s language', () => {
  it.each(Object.keys(CATALOGS))('%s carries exactly the pack keys English does', (locale) => {
    expect(packKeys(CATALOGS[locale]!)).toEqual(packKeys(en));
  });

  it('keeps the English catalog identical to the English source in the template', () => {
    for (const template of CREATION_TEMPLATES) {
      const localized = localizePack(template, packText('en'), 'en');
      expect(withoutCourse(localized.objects)).toEqual(withoutCourse(template.objects));
      expect(localized.connections).toEqual(template.connections);
    }
  });

  it.each(['zh', 'es', 'fr', 'de'])('%s changes every card title that carries a key, and keeps the structure', (locale) => {
    for (const template of CREATION_TEMPLATES) {
      const localized = localizePack(template, packText(locale), locale);
      expect(localized.objects.map((object) => object.kind)).toEqual(template.objects.map((object) => object.kind));
      expect(localized.connections?.map(({ source, target, ref }) => [source, target, ref])).toEqual(template.connections?.map(({ source, target, ref }) => [source, target, ref]));
      // No catalog path leaked into a placed string.
      expect(JSON.stringify(localized)).not.toMatch(/pack\.[a-z0-9-]+\.[oe]\d/);
    }
  });

  it('zh actually localizes: at least one card title differs from English', () => {
    const differing = CREATION_TEMPLATES.flatMap((template) => {
      const english = localizePack(template, packText('en'), 'en').objects;
      const zhObjects = localizePack(template, packText('zh'), 'zh').objects;
      return zhObjects.filter((object, index) => object.title !== undefined && object.title !== english[index]!.title);
    });
    expect(differing.length).toBeGreaterThan(0);
  });

  it('every string in every pack has an English catalog key or is an allowlisted token', () => {
    const has = packText('en').has;
    const untranslated: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'string') {
        if (!has(path) && !isToken(path, value)) untranslated.push(`${path} = ${JSON.stringify(value)}`);
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}.${index}`));
      } else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
      }
    };
    for (const template of CREATION_TEMPLATES) {
      const base = `pack.${template.id}`;
      template.objects.forEach((object, index) => {
        walk(object.title, `${base}.o${index}.title`);
        walk(object.data, `${base}.o${index}.data`);
      });
      template.connections?.forEach((connection, index) => walk(connection.label, `${base}.e${index}`));
    }
    // A new card string with no catalog key lands here, so it cannot ship English-only.
    expect(untranslated).toEqual([]);
  });

  it.each(['zh', 'es', 'fr', 'de'])('%s mints the worked course in that language', (locale) => {
    const academy = CREATION_TEMPLATES.find((template) => template.id === 'llm-builder-academy')!;
    const english = localizePack(academy, packText('en'), 'en').objects[0]!.data!.course as CanvasCourse;
    const localized = localizePack(academy, packText(locale), locale).objects[0]!.data!.course as CanvasCourse;
    // The course records the BCP-47 tag (`zh-CN`), matching buildLlmCourse's `'en-US'` convention.
    expect(localized.language).toBe(localeToBcp47(locale));
    expect(localized.subject).not.toBe(english.subject);
    expect(localized.modules.map((module) => module.id)).toEqual(english.modules.map((module) => module.id));
  });
});
