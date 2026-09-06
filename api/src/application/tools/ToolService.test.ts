import { describe, expect, it } from 'vitest';
import { ToolService } from './ToolService';
import type { Db } from '../../infrastructure/database/connection';
import { TRANSLATED_TOOL_LOCALES, DEFAULT_TOOL_LOCALE, toolCatalog } from './toolMessages';
import { TOOL_LOCALES } from './resultCopy';

/**
 * The `/api/tools` list degrades to English for a locale with no catalog. That is
 * the right behaviour for a public page and the wrong thing to do silently, so the
 * response says which language it actually answered in — computed by the service,
 * from the same catalog the localizer reads, never re-derived in a route.
 */
describe('ToolService.toolLocalization', () => {
  const service = new ToolService({} as Db);

  it('reports English as served in-locale without a catalog', () => {
    expect(service.toolLocalization(DEFAULT_TOOL_LOCALE)).toEqual({
      locale: DEFAULT_TOOL_LOCALE,
      translated: true,
      translatedLocales: TRANSLATED_TOOL_LOCALES,
    });
    expect(service.toolLocalization().locale).toBe(DEFAULT_TOOL_LOCALE);
  });

  it.each(TRANSLATED_TOOL_LOCALES)('reports %s as translated exactly when its catalog exists', (locale) => {
    const localization = service.toolLocalization(locale);
    expect(localization.locale).toBe(locale);
    expect(localization.translated).toBe(toolCatalog(locale) !== undefined);
    expect(localization.translatedLocales).toContain(locale);
  });

  it('covers every locale the platform serves — nothing degrades silently', () => {
    for (const locale of TOOL_LOCALES) {
      expect(service.toolLocalization(locale).translated, locale).toBe(true);
    }
    expect(service.toolLocalization().translatedLocales).not.toContain(DEFAULT_TOOL_LOCALE);
  });
});
