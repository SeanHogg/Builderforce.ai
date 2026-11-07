/**
 * The shared `<TranslatableText>`'s copy from Rovr's catalogs, through brain-ui's ONE key
 * table (`translationLabelsFrom`): `translation.<field>` reads `translation<Field>`.
 */
import { translationLabelsFrom, type TranslationLabels } from '@seanhogg/builderforce-brain-ui';
import { t, type MessageKey } from '../../i18n/t';

/** The Rovr catalog key a translation label field reads (`showOriginal` → `translationShowOriginal`). A registry the locale test holds to the same rule as `t('…')` calls. */
export function rovrTranslationKey(field: keyof TranslationLabels): MessageKey {
  return `translation${field.charAt(0).toUpperCase()}${field.slice(1)}` as MessageKey;
}

export function rovrTranslationLabels(): TranslationLabels {
  return translationLabelsFrom((key) => t(rovrTranslationKey(key.slice('translation.'.length) as keyof TranslationLabels)));
}
