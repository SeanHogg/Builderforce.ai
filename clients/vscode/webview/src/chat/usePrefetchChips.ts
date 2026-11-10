/**
 * The PreFetch chips: a write action's confirm chip (in the confirm slot) and the next-step
 * chips under a tool's answer, whose command the HOST runs. One stable group per label bundle.
 */
import { useMemo } from 'react';
import { post, type InitData } from '../vscodeBridge';
import { prefetchChipLabels, prefetchLabelOf } from './chatLabels';

export function usePrefetchChips(labels: InitData['labels']) {
  return useMemo(() => ({
    labels: prefetchChipLabels(labels),
    labelOf: prefetchLabelOf(labels),
    onChip: (chip: { command: string; args?: Record<string, unknown> }) => post('prefetch.chip', { command: chip.command, args: chip.args ?? {} }),
  }), [labels]);
}
