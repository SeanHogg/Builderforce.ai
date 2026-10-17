// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { BrainComposerLabels, ComposerLabels } from '@seanhogg/builderforce-brain-ui';
import { useChatModeCopy, type ChatModeVocabulary } from '@/lib/brain/useChatModeCopy';
import { useComposerOptionLabels } from './useComposerOptionLabels';
import { useSpendLabels } from './useSpendLabels';
import { useWorkStatusLabels } from './useWorkStatusLabels';

/**
 * The shared composer's own copy — the box, `+`, the trailing button and the sentences
 * the `/` menu's rows state their real effect with — from the `chatInput` catalog.
 * The mode names are the conversation's vocabulary (`useChatModeCopy`), the same words
 * the Brain empty state uses.
 */
function useComposerCopy(modeVocabulary: ChatModeVocabulary | undefined): Partial<ComposerLabels> {
  const t = useTranslations('chatInput');
  const tBrain = useTranslations('brain');
  const mode = useChatModeCopy(modeVocabulary);
  return useMemo<Partial<ComposerLabels>>(() => ({
    placeholder: t('placeholder'),
    add: t('add'),
    upload: t('upload'),
    uploading: t('uploading'),
    addContext: t('addContext'),
    browseWeb: t('browseWeb'),
    on: t('on'),
    off: t('off'),
    remove: t('removeAttachment'),
    send: t('send'),
    queueSend: t('queueSend'),
    stop: t('stop'),
    dictate: t('dictate'),
    stopDictation: t('stopDictation'),
    modeLabel: mode.label,
    modeHint: mode.hint,
    memoryOnHint: t('memoryOnHint'),
    memoryOffHint: t('memoryOffHint'),
    memoryUnavailable: tBrain('memoryUnavailable'),
    autoModeHint: t('autoModeHint'),
    effortDesc: (level, answer) => t(`effortDesc_${level}`, { answer }),
    effortThinkingSuffix: (thinking) => t('effortDescThinking', { thinking }),
    thinkingOnDesc: (budget) => t('thinkingOnDesc', { budget }),
    thinkingOffDesc: t('thinkingOffDesc'),
  }), [t, tBrain, mode]);
}

/**
 * THE web's copy for the shared `BrainComposer`, every part of it from next-intl:
 * the box itself, the `/` menu, its Status tab, the spend card, and the @/# pickers.
 * One hook so every mount of the composer speaks with the same words.
 */
export function useBrainComposerLabels(modeVocabulary?: ChatModeVocabulary): BrainComposerLabels {
  const t = useTranslations('chatInput');
  const composer = useComposerCopy(modeVocabulary);
  const options = useComposerOptionLabels();
  const status = useWorkStatusLabels();
  const spend = useSpendLabels();
  return useMemo<BrainComposerLabels>(() => ({
    composer,
    options,
    status,
    spend,
    mention: { title: t('mentionTitle'), agent: t('mentionAgent'), human: t('mentionHuman') },
    ticket: { title: t('ticketTagTitle'), status: t('ticketTagStatus'), noMatches: t('ticketTagNoMatches') },
  }), [t, composer, options, status, spend]);
}
