// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useMemo } from 'react';
import { brainComposerLabelsFrom, type BrainComposerLabels } from '@seanhogg/builderforce-brain-ui';
import { useChatModeCopy, type ChatModeVocabulary } from '@/lib/brain/useChatModeCopy';
import { useLabelLookup } from '@/i18n/useLabelLookup';
import { spendCatalogPath } from './useSpendLabels';

/** Composer keys whose `chatInput` message is named differently. */
const COMPOSER_PATH: Readonly<Record<string, string>> = {
  remove: 'chatInput.removeAttachment',
  memoryUnavailable: 'brain.memoryUnavailable',
  'effortDesc.quick': 'chatInput.effortDesc_quick',
  'effortDesc.balanced': 'chatInput.effortDesc_balanced',
  'effortDesc.thorough': 'chatInput.effortDesc_thorough',
  effortThinkingSuffix: 'chatInput.effortDescThinking',
};

/** `/` menu keys named differently in `chatInput`. */
const OPTIONS_PATH: Readonly<Record<string, string>> = {
  effortQuick: 'chatInput.effort_quick',
  effortBalanced: 'chatInput.effort_balanced',
  effortThorough: 'chatInput.effort_thorough',
};

/**
 * `/` menu keys the web does NOT read from the catalog: the mode heading is the
 * conversation's vocabulary (`useChatModeCopy`), and the two per-row funding lines that
 * interpolate a value (vendor, metered price) are formatted by `useChatModelOptions`.
 */
const OPTIONS_NOT_FROM_CATALOG = new Set(['mode', 'paidCostDetail', 'byoDetail']);

/** The Status tab reuses the strings the web already owns for the same facts: meter
 *  names and "Unlimited" from `usageMeter`, the Evermind posture from `evermindStatus`. */
const STATUS_PATH: Readonly<Record<string, string>> = {
  usage: 'usageMeter.title',
  unlimited: 'usageMeter.unlimited',
  evermind: 'evermindStatus.label',
  evermindLearning: 'evermindStatus.learning',
  evermindFrozen: 'evermindStatus.frozen',
};

const PICKER_PATH: Readonly<Record<string, string>> = {
  'mention.title': 'chatInput.mentionTitle',
  'mention.agent': 'chatInput.mentionAgent',
  'mention.human': 'chatInput.mentionHuman',
  'ticket.title': 'chatInput.ticketTagTitle',
  'ticket.status': 'chatInput.ticketTagStatus',
  'ticket.noMatches': 'chatInput.ticketTagNoMatches',
};

/** Where one of brain-ui's scoped composer keys lives in the web catalog. */
function composerCatalogPath(scoped: string): string | undefined {
  const dot = scoped.indexOf('.');
  const part = scoped.slice(0, dot);
  const key = scoped.slice(dot + 1);
  switch (part) {
    case 'composer':
      // The mode names/hints come from the conversation's vocabulary (overrides below).
      if (key.startsWith('modeLabel.') || key.startsWith('modeHint.')) return undefined;
      return COMPOSER_PATH[key] ?? `chatInput.${key}`;
    case 'options':
      if (OPTIONS_NOT_FROM_CATALOG.has(key)) return undefined;
      return OPTIONS_PATH[key] ?? `chatInput.${key}`;
    case 'status':
      if (key.startsWith('meters.')) return `usageMeter.meter.${key.slice('meters.'.length)}`;
      return STATUS_PATH[key] ?? `workStatus.${key}`;
    case 'spend':
      return spendCatalogPath(key);
    case 'connections':
      return `providerConnections.${key}`;
    default:
      return PICKER_PATH[scoped];
  }
}

/**
 * THE web's copy for the shared `BrainComposer` — the box, the `/` menu, its Status tab,
 * the spend card and the @/# pickers — through brain-ui's ONE key table
 * (`brainComposerLabelsFrom`), which also holds the English for anything the catalog
 * lacks. This only says where each key lives in next-intl. The mode names are the
 * conversation's vocabulary (`useChatModeCopy`), the same words the Brain empty state uses.
 */
export function useBrainComposerLabels(modeVocabulary?: ChatModeVocabulary): BrainComposerLabels {
  const lookup = useLabelLookup(composerCatalogPath);
  const mode = useChatModeCopy(modeVocabulary);
  return useMemo<BrainComposerLabels>(() => brainComposerLabelsFrom(lookup, {
    composer: { modeLabel: mode.label, modeHint: mode.hint },
    options: { mode: mode.pickerAria },
  }), [lookup, mode]);
}
