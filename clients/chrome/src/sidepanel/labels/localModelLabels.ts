/**
 * The on-device model list's copy (brain-ui's shared `LocalModelList`) from Rovr's
 * catalogs, through brain-ui's ONE key table (`localModelLabelsFrom`) — used by Settings →
 * Model and by the composer's `/` Model tab (`composerLabels.ts`).
 */
import { localModelLabelsFrom, type LocalModelLabels } from '@seanhogg/builderforce-brain-ui';
import { t, type MessageKey } from '../../i18n/t';

/** Rovr's own keys where they differ from `lm<Field>` — Cancel and Remove are the
 *  panel's general verbs, not list-specific copy. */
const ROVR_LOCAL_MODEL_KEY: Partial<Record<keyof LocalModelLabels, MessageKey>> = {
  localCancel: 'cancel',
  localRemove: 'remove',
};

/** The Rovr catalog key a list field reads (`localTools` → `lmTools`). A registry the
 *  locale test holds to the same rule as `t('…')` calls. */
export function rovrLocalModelKey(field: keyof LocalModelLabels): MessageKey {
  return ROVR_LOCAL_MODEL_KEY[field] ?? (`lm${field.slice('local'.length)}` as MessageKey);
}

export function rovrLocalModelLabels(): LocalModelLabels {
  return localModelLabelsFrom((field) => t(rovrLocalModelKey(field)));
}
