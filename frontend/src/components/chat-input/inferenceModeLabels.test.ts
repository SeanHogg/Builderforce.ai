/**
 * Registry-driven localization: every inference-mode label the shared `/` menu and
 * first-run question read (brain-ui's `INFERENCE_MODE_LABEL_FIELDS`, resolved at
 * `chatInput.<key>` by `useBrainComposerLabels`) and the "nothing can take this turn"
 * banner labels (`brain.<key>`, `useModelRemedies`) resolve in EVERY locale — not merely
 * agree between catalogs.
 */
import { describe, expect, it } from 'vitest';
import { INFERENCE_MODE_LABEL_FIELDS } from '@seanhogg/builderforce-brain-ui';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

const CATALOGS = { en, zh, es, fr, de } as unknown as Record<string, Record<string, Record<string, unknown>>>;
const BANNER_KEYS = [
  'noLocalModel',
  'switchToHybrid',
  'downloadLocalModel',
  'noSpecificModel',
  'pickModel',
  // The on-device engine failures (`local_engine_failed`).
  'engineCrashed',
  'engineDetached',
  'modelKeepsCrashing',
  'manageLocalModels',
] as const;

describe('inference mode copy resolves in every locale', () => {
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    it(`${locale}: every chatInput.inferenceMode* and brain banner key`, () => {
      expect(INFERENCE_MODE_LABEL_FIELDS.length).toBeGreaterThan(0);
      for (const field of INFERENCE_MODE_LABEL_FIELDS) {
        const text = catalog.chatInput?.[field];
        expect(typeof text === 'string' && text.length > 0, `${locale} chatInput.${field}`).toBe(true);
      }
      for (const key of BANNER_KEYS) {
        const text = catalog.brain?.[key];
        expect(typeof text === 'string' && text.length > 0, `${locale} brain.${key}`).toBe(true);
      }
    });
  }

  it('is translated, not copied: each locale words the question its own way', () => {
    const asked = Object.values(CATALOGS).map((catalog) => catalog.chatInput?.inferenceModeAskTitle);
    expect(new Set(asked).size).toBe(asked.length);
  });
});
