import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';
import { LOCALES, type Locale } from '@/i18n/config';
import {
  ATS_LABELLED_DECISIONS,
  ATS_LABELLED_KIT_STAGE_KINDS,
  ATS_LABELLED_OFFER_STATUSES,
} from '@/lib/hiringApi';

/**
 * Labels the key guard CANNOT see.
 *
 * The hiring surface builds three families of message key by interpolation —
 * `ats.decision.kind.${decision}`, `ats.offer.status.${status}`,
 * `ats.kits.kind.${kind}` — because the values come off the wire. `check-i18n-keys.mjs`
 * reads literal `t('…')` call sites, so none of these are visible to it, and next-intl
 * renders the dotted path when a message is missing. The failure mode is therefore a raw
 * `ats.offer.status.expired` sitting where a status chip belongs, in five languages, with
 * every other guard green.
 *
 * This is the assertion that closes it, and it is the same shape `messages.test.ts` uses
 * for every other registry-driven label in the app.
 */
const CATALOGS: Record<Locale, Record<string, unknown>> = { en, zh, es, fr, de } as never;

const KEYS = [
  ...ATS_LABELLED_DECISIONS.map((decision) => `ats.decision.kind.${decision}`),
  ...ATS_LABELLED_OFFER_STATUSES.map((status) => `ats.offer.status.${status}`),
  ...ATS_LABELLED_KIT_STAGE_KINDS.map((kind) => `ats.kits.kind.${kind}`),
];

describe('ATS interpolated labels', () => {
  it.each(LOCALES)('%s labels every decision, offer status and kit stage kind', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale], onError: () => {} });
    const missing = KEYS.filter((key) => !t.has(key as never));
    expect(missing).toEqual([]);
  });

  /** A label that is present but empty renders as nothing at all, which reads as a
   *  missing status rather than as a missing translation. */
  it.each(LOCALES)('%s gives each of them a non-empty word', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale], onError: () => {} });
    const blank = KEYS.filter((key) => !String(t(key as never)).trim());
    expect(blank).toEqual([]);
  });
});
