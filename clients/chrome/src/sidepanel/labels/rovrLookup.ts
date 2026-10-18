/**
 * Rovr's adapter onto brain-ui's catalog → labels contract (`LabelLookup`): a canonical
 * key goes through a table to its `chrome.i18n` message key (no entry: brain-ui's
 * English default stands), and a parameterised label's figures become Chrome's
 * positional `$1`, `$2` — numbers formatted for the panel's locale.
 */
import type { LabelLookup } from '@seanhogg/builderforce-brain-ui';
import { t, type MessageKey } from '../../i18n/t';

/** A count in the panel's locale (token budgets, ticket counts). */
export const formatCount = (n: number): string => n.toLocaleString(chrome.i18n.getUILanguage());

export function rovrLookup(keyOf: (key: string) => MessageKey | undefined): LabelLookup {
  return (key, values) => {
    const messageKey = keyOf(key);
    if (!messageKey) return undefined;
    const subs = values ? Object.values(values).map((v) => (typeof v === 'number' ? formatCount(v) : v)) : [];
    return t(messageKey, ...subs);
  };
}
