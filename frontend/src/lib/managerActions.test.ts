import { describe, it, expect } from 'vitest';
import { MANAGER_ACTION_ICON, isManagerActionType, managerActionIcon } from './managerActions';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

/**
 * EVERY MANAGER ACTION TYPE MUST BE RENDERABLE, IN EVERY LOCALE.
 *
 * The icon side is already safe: `MANAGER_ACTION_ICON` is a `Record<ManagerActionType,
 * string>`, so adding a type without an icon fails the type check. The LABEL side had no
 * such guard — `manager.action.*` is a JSON catalog, and a new type simply rendered its
 * raw key ("merge_failed") to the user, in English, in all five locales, with nothing
 * failing.
 *
 * That is not hypothetical: 0381 added `merge_failed` and `pr_conflict` to the manager's
 * decision feed, and the only thing that would have caught a missed catalog is this test.
 * It is written over the type registry rather than a fixed list, so the NEXT type added
 * is covered without anyone remembering to extend it.
 */
const CATALOGS: Record<string, { manager: { action: Record<string, string> } }> = {
  en, zh, es, fr, de,
};

describe('manager action registry', () => {
  const types = Object.keys(MANAGER_ACTION_ICON);

  it('knows at least the types the manager writes today', () => {
    // A sanity floor: if this ever reads as empty the loops below pass vacuously.
    expect(types.length).toBeGreaterThanOrEqual(15);
    expect(types).toContain('merge_failed');
    expect(types).toContain('pr_conflict');
  });

  for (const [locale, messages] of Object.entries(CATALOGS)) {
    it(`has a ${locale} label for every action type`, () => {
      const labels = messages.manager.action;
      const missing = types.filter((t) => !labels[t]?.trim());
      expect(missing, `${locale}.json manager.action is missing: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('does not leave a non-English catalog as an English copy for the new types', () => {
    // The localization rule this repo runs on: zh/es/fr/de must be real translations,
    // not en placeholders. Checked on the two types 0381 added.
    for (const locale of ['zh', 'es', 'fr', 'de']) {
      for (const type of ['merge_failed', 'pr_conflict']) {
        expect(
          CATALOGS[locale]!.manager.action[type],
          `${locale}.json manager.action.${type} is still the English string`,
        ).not.toBe(CATALOGS.en!.manager.action[type]);
      }
    }
  });

  it('degrades to a neutral bullet for a type this build predates', () => {
    // The feed must never render a missing-key path for an action a NEWER api emits.
    expect(isManagerActionType('not_a_real_type')).toBe(false);
    expect(managerActionIcon('not_a_real_type')).toBe('•');
    expect(managerActionIcon('merge_failed')).toBe(MANAGER_ACTION_ICON.merge_failed);
  });
});
