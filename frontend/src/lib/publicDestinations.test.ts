import { describe, expect, it } from 'vitest';
import en from '../i18n/messages/en.json';
import zh from '../i18n/messages/zh.json';
import es from '../i18n/messages/es.json';
import fr from '../i18n/messages/fr.json';
import de from '../i18n/messages/de.json';
import { REFERENCE_DESTINATIONS } from './publicDestinations';

interface DomainCopy {
  title?: string;
  tagline?: string;
  hero?: string;
  description?: string;
  features?: { title?: string; description?: string }[];
}

const CATALOGS = { en, zh, es, fr, de } as unknown as Record<
  string,
  { burnrateMarketing: { domains: Record<string, DomainCopy> } }
>;

describe('public destination copy', () => {
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    describe(locale, () => {
      it.each(REFERENCE_DESTINATIONS.map((entry) => [entry.id, entry.copyId] as const))(
        '%s resolves its burnrateMarketing.domains copy',
        (_id, copyId) => {
          const copy = catalog.burnrateMarketing.domains[copyId as string];
          expect(copy, `missing domains.${copyId}`).toBeDefined();
          expect(copy.title).toBeTruthy();
          expect(copy.tagline).toBeTruthy();
          expect(copy.hero).toBeTruthy();
          expect(copy.description).toBeTruthy();
          expect(copy.features?.length).toBeGreaterThan(0);
          for (const feature of copy.features ?? []) {
            expect(feature.title).toBeTruthy();
            expect(feature.description).toBeTruthy();
          }
        },
      );
    });
  }
});
