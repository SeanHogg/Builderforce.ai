/**
 * Rovr's localization — Chrome's own (`_locales/<locale>/messages.json`, read through
 * `chrome.i18n.getMessage`), so the manifest's name and description and the panel's copy
 * come from one catalog per locale. Every key the source uses is listed in
 * {@link MESSAGE_KEYS}; `locales.test.ts` resolves each against all five catalogs.
 *
 * Substitutions are positional (`$1`, `$2`) — Chrome's rule.
 */
import { MESSAGE_KEYS, type MessageKey } from './keys';

export { MESSAGE_KEYS, type MessageKey };

export function t(key: MessageKey, ...subs: Array<string | number>): string {
  const text = chrome.i18n.getMessage(key, subs.map(String));
  return text || key;
}

/** The catalog locale the panel is showing, as the web catalogs name them. */
export function uiCatalogLocale(): 'en' | 'de' | 'es' | 'fr' | 'zh' {
  const ui = chrome.i18n.getUILanguage().toLowerCase();
  if (ui.startsWith('de')) return 'de';
  if (ui.startsWith('es')) return 'es';
  if (ui.startsWith('fr')) return 'fr';
  if (ui.startsWith('zh')) return 'zh';
  return 'en';
}
