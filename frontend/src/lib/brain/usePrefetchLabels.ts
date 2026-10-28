import { useMemo } from 'react';
import { prefetchChipLabelsFrom, type PrefetchChipLabels, type PrefetchLabelOf } from '@seanhogg/builderforce-brain-ui';
import { useLabelLookup } from '@/i18n/useLabelLookup';

/** The PreFetch chip's copy: `brain.prefetch.<field>`. */
const chipPath = (key: string): string => `brain.prefetch.${key}`;

/**
 * A row's or chip's name: `prefetch.action.lint.fix` → `brain.prefetch.action.lint_fix`,
 * `prefetch.chip.openInGraph` → `brain.prefetch.openInGraph`.
 */
const labelKeyPath = (key: string): string | undefined => {
  if (key.startsWith('prefetch.action.')) return `brain.prefetch.action.${key.slice('prefetch.action.'.length).replace(/[.-]/g, '_')}`;
  if (key.startsWith('prefetch.chip.')) return `brain.prefetch.${key.slice('prefetch.chip.'.length)}`;
  return undefined;
};

/**
 * THE web's PreFetch copy, in the web's own language (`brain.prefetch.*`): the confirm
 * chip's sentences and every action and chip name — one hook for the confirm bar
 * (`RunConfirmBar`) and the transcript's answer rows, so both read the same words.
 */
export function usePrefetchLabels(): { labels: PrefetchChipLabels; labelOf: PrefetchLabelOf } {
  const chipLookup = useLabelLookup(chipPath);
  const keyLookup = useLabelLookup(labelKeyPath);
  return useMemo(() => ({
    labels: prefetchChipLabelsFrom(chipLookup),
    labelOf: (key: string) => keyLookup(key),
  }), [chipLookup, keyLookup]);
}
