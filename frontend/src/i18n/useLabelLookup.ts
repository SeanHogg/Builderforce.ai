import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { LabelLookup } from '@seanhogg/builderforce-brain-ui';

/**
 * The shared components' row/readout placeholders, handed through LITERALLY: brain-ui
 * fills `{amount}`, `{used}`, `{runtime}`, `{title}` … itself, and formatting a next-intl message
 * with none of its values throws FORMATTING_ERROR. Extra entries are ignored by a
 * message that has no such placeholder.
 */
const PASSTHROUGH = {
  amount: '{amount}', tokens: '{tokens}', pct: '{pct}', count: '{count}', days: '{days}',
  used: '{used}', limit: '{limit}', unit: '{unit}', version: '{version}',
  size: '{size}', percent: '{percent}', runtime: '{runtime}', title: '{title}', owner: '{owner}',
  code: '{code}', action: '{action}',
} as const;

/**
 * THE web's adapter onto brain-ui's catalog → labels contract (`LabelLookup`): a
 * canonical key goes through `pathOf` to its next-intl message path (undefined: leave
 * it to brain-ui's English default), and a path the catalog lacks is reported as
 * missing rather than rendered as its key. Parameterised copy gets its real figures
 * (ICU formats them); every other string keeps its placeholders literal.
 *
 * `pathOf` must be a module-level function — it is a memo dependency.
 *
 * No `'use client'` of its own: only ever imported by client components.
 */
export function useLabelLookup(pathOf: (key: string) => string | undefined): LabelLookup {
  const t = useTranslations();
  return useMemo<LabelLookup>(() => (key, values) => {
    const path = pathOf(key);
    if (!path) return undefined;
    // A translator without `has` (a bare test double) echoes a missing key's path.
    if (typeof t.has === 'function' && !t.has(path)) return undefined;
    const text = t(path, values ?? PASSTHROUGH);
    return text && text !== path ? text : undefined;
  }, [t, pathOf]);
}
