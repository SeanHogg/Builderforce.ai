/**
 * The test stand-in for `virtual:rovr-knowledge-catalogs` (served by `build.mjs`): the
 * web's REAL five catalogs, trimmed to `knowledgeGraph` exactly as the build trims them,
 * so a test of the Knowledge view reads the strings the shipped panel reads. Aliased in
 * `vitest.config.ts`.
 */
import en from '../../../../frontend/src/i18n/messages/en.json';
import de from '../../../../frontend/src/i18n/messages/de.json';
import es from '../../../../frontend/src/i18n/messages/es.json';
import fr from '../../../../frontend/src/i18n/messages/fr.json';
import zh from '../../../../frontend/src/i18n/messages/zh.json';

const pick = (messages: { knowledgeGraph?: unknown }): Record<string, unknown> => (messages.knowledgeGraph ?? {}) as Record<string, unknown>;

const catalogs: Record<'en' | 'de' | 'es' | 'fr' | 'zh', Record<string, unknown>> = {
  en: pick(en), de: pick(de), es: pick(es), fr: pick(fr), zh: pick(zh),
};
export default catalogs;
