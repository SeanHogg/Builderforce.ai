'use client';

/**
 * Localized modality copy — the ONE place the IDE reads a modality's user-facing
 * `label` / `tagline` / `runLabel` from the i18n catalogs (`ide.modality.<id>.*`).
 *
 * The `MODALITIES` registry keeps English `label`/`tagline`/`runLabel` as defaults
 * for non-React contexts (the Brain system prompt, tests, server code); every place
 * that SHOWS a modality to the user goes through this hook so the text is translated
 * in all five locales. DRY: consumers never inline `getModality(id).label` for
 * display — they call the resolver here.
 */

import { useTranslations } from 'next-intl';
import { getModality, MODALITIES, RIGHT_TAB_ICONS, type ModalityDef, type ProjectModality, type RightTab } from './modality';

/** Returns a resolver that maps a modality id (incl. legacy `llm`) to its definition
 *  with `label` / `tagline` / `runLabel` replaced by their localized catalog values. */
export function useModalityCopy(): (id: ProjectModality | string | null | undefined) => ModalityDef {
  const t = useTranslations('ide');
  return (id) => {
    const m = getModality(id);
    return {
      ...m,
      label: t(`modality.${m.id}.label`),
      tagline: t(`modality.${m.id}.tagline`),
      runLabel: t(`modality.${m.id}.runLabel`),
    };
  };
}

/**
 * Localized right-panel tab labels — the glyph from the registry plus the word
 * from the catalogs (`ide.rightTab.<id>`). Same rule as the modality copy above:
 * the registry holds what is locale-independent, this hook holds what is shown.
 */
export function useRightTabLabels(): (tab: RightTab) => string {
  const t = useTranslations('ide');
  return (tab) => `${RIGHT_TAB_ICONS[tab]} ${t(`rightTab.${tab}`)}`;
}

/** The full modality list (registry order) with localized copy — for choosers/filters. */
export function useLocalizedModalities(): ModalityDef[] {
  const copy = useModalityCopy();
  return MODALITIES.map((m) => copy(m.id));
}
