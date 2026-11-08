/**
 * A CREATION PACK, IN THE BOARD'S LANGUAGE.
 *
 * `CREATION_TEMPLATES` is structure plus English SOURCE copy: the object kinds,
 * their positions, the connections between them, and the starter text each card
 * is seeded with. A pack's name and blurb were already read from the catalogs
 * (`creationCanvas.template.<id>.*`); the rest of its copy — every card title,
 * seeded status, summary, list item and connection label — was placed verbatim,
 * so a zh, es, fr or de board that placed a pack got an English board, persisted
 * (a placed title does not re-translate when the viewer's language changes).
 *
 * This is the ONE seam that resolves a pack through the catalogs, called where a
 * pack is PLACED (`useCanvasTemplates.applyTemplate`) with the board's own
 * `creationCanvas` translator — the same seam `buildLlmCourse` already used.
 *
 * ── THE KEY SCHEME ──────────────────────────────────────────────────────────
 * Every key is under `creationCanvas.pack.<packId>`:
 *
 *   o<i>.title                card `i`'s title
 *   o<i>.data.<path>          any STRING inside card `i`'s `data`, addressed by
 *                             its path (`status`, `criteria.0`, `steps.2.title`,
 *                             `cards.3.note`, …) — arrays are addressed by index
 *   e<i>                      connection `i`'s label
 *
 * A string with NO catalog entry is left as written. That is deliberate and is
 * what keeps the TOKENS literal — `connector`, `action`, `cron`, `language`,
 * `input` template placeholders, enum values (`discipline: 'fieldService'`) are
 * identifiers the registry and the connectors match on, not copy, so they are
 * never given a key. The ratchet in `messages.test.ts` proves the five locales
 * carry the same set of pack keys, so a locale cannot silently fall back to
 * English for a string another locale translated.
 *
 * The worked LLM course is not a string in the pack at all: the object carries
 * `worked: 'llmCourse'` and the course is minted HERE through the same translator,
 * so it lands in the board's language with no module-scope English.
 */

import { buildLlmCourse, type CourseTextTranslator } from '@/lib/courseLms';
import { localeToBcp47 } from '@/i18n/config';
import type { CreationTemplate } from '@/lib/templates/creationTemplates';

/** What a pack needs from the board's `creationCanvas` translator. */
export interface PackText {
  /** `creationCanvas.<key>` rendered in the board's language. */
  text: CourseTextTranslator;
  /** Whether the catalog carries `creationCanvas.<key>`. */
  has: (key: string) => boolean;
}

function localizeValue(value: unknown, path: string, pack: PackText): unknown {
  if (typeof value === 'string') return pack.has(path) ? pack.text(path) : value;
  if (Array.isArray(value)) return value.map((item, index) => localizeValue(item, `${path}.${index}`, pack));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localizeValue(item, `${path}.${key}`, pack)]));
  }
  return value;
}

/**
 * Resolve every translatable string of `template` through the catalogs.
 *
 * @param language The board's locale (`zh`); recorded on the worked course as its
 *   BCP-47 tag (`zh-CN`), matching `buildLlmCourse`'s `'en-US'` convention.
 */
export function localizePack(template: CreationTemplate, pack: PackText, language: string): CreationTemplate {
  const base = `pack.${template.id}`;
  return {
    ...template,
    objects: template.objects.map((object, index) => {
      const at = `${base}.o${index}`;
      const data = object.data ? localizeValue(object.data, `${at}.data`, pack) as NonNullable<typeof object.data> : undefined;
      const title = object.title === undefined ? undefined : (pack.has(`${at}.title`) ? pack.text(`${at}.title`) : object.title);
      const withCourse = object.worked === 'llmCourse'
        ? { ...(data ?? {}), course: buildLlmCourse(pack.text, localeToBcp47(language)) }
        : data;
      return { ...object, ...(title === undefined ? {} : { title }), ...(withCourse ? { data: withCourse } : {}) };
    }),
    ...(template.connections ? {
      connections: template.connections.map((connection, index) => (
        pack.has(`${base}.e${index}`) ? { ...connection, label: pack.text(`${base}.e${index}`) } : connection
      )),
    } : {}),
  };
}
