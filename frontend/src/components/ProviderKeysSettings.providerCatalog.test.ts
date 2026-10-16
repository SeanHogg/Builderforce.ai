import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { LLM_PROVIDER_INFO } from '@builderforce/model-catalog';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';
import { LOCALES, type Locale } from '@/i18n/config';

/**
 * The settings page builds `providerKeys.provider.${id}.…` keys from the SHARED provider
 * list (`@builderforce/model-catalog`), so the key guard — which reads literal `t('…')`
 * calls — cannot see them, and next-intl renders the dotted path when one is missing.
 * Adding a key provider (or a subscription connect) to the shared list is incomplete until
 * every catalog carries its copy; this is the assertion that says so.
 */
const CATALOGS: Record<Locale, Record<string, unknown>> = { en, zh, es, fr, de } as never;

const KEYS = [
  'providerKeys.selfHostedLabel',
  ...LLM_PROVIDER_INFO.filter((p) => p.credential === 'api_key').flatMap((p) => [
    `providerKeys.provider.${p.id}.blurb`,
    ...(p.subscription !== null ? [`providerKeys.provider.${p.id}.subscription`] : []),
    ...(p.subscription === 'paste'
      ? [`providerKeys.provider.${p.id}.pastePrompt`, `providerKeys.provider.${p.id}.pastePlaceholder`]
      : []),
  ]),
];

describe('provider settings copy', () => {
  it.each(LOCALES)('%s carries every key the shared provider list asks for', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale], onError: () => {} });
    expect(KEYS.filter((key) => !t.has(key as never))).toEqual([]);
  });

  it.each(LOCALES)('%s keeps the brand in the self-hosted label', (locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale], onError: () => {} });
    expect(t('providerKeys.selfHostedLabel' as never, { brand: 'FreeToken' } as never)).toContain('FreeToken');
  });
});
