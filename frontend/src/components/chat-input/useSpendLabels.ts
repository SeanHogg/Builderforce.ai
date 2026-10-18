// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useMemo } from 'react';
import { spendLabelsFrom, type SpendLabels } from '@seanhogg/builderforce-brain-ui';
import { useLabelLookup } from '@/i18n/useLabelLookup';

/** Where one of brain-ui's spend keys lives in the web catalog — the `spend` namespace,
 *  under the same names (`sources.<key>`, `sourceHints.<key>` included). */
export function spendCatalogPath(key: string): string {
  return `spend.${key}`;
}

/**
 * The shared spend & savings readouts' copy (the chat's spend pill in the info strip,
 * and the Status tab's 30-day card), through brain-ui's ONE key table
 * (`spendLabelsFrom`). The shared components fill `{amount}`, `{tokens}`, `{pct}`,
 * `{count}` and `{days}` themselves, so the lookup hands those through literally.
 */
export function useSpendLabels(): SpendLabels {
  const lookup = useLabelLookup(spendCatalogPath);
  return useMemo(() => spendLabelsFrom(lookup), [lookup]);
}
