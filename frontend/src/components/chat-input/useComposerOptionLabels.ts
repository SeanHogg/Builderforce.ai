import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { PromptOptionsLabels } from '@seanhogg/builderforce-brain-ui';

/**
 * The `/` menu's copy. Localized here (next-intl) and handed to the SHARED
 * control, so the web and the editor render the same menu from their own bundles.
 * The per-row funding lines that interpolate a value (the BYO vendor, the metered
 * price) are formatted by the options builder instead — see useChatModelOptions.
 */
export function useComposerOptionLabels(): Partial<PromptOptionsLabels> {
  const t = useTranslations('chatInput');
  // The two mode names are the conversation's vocabulary, not the composer's — they
  // are the SAME words the Brain empty state uses, from the same catalog namespace.
  const tModes = useTranslations('brain.modes');
  return useMemo<Partial<PromptOptionsLabels>>(() => ({
    options: t('options'),
    mode: tModes('pickerAria'),
    memory: t('memory'),
    autoMode: t('autoMode'),
    autoModeHint: t('autoModeHint'),
    conversation: t('conversation'),
    consolidate: t('consolidate'),
    consolidating: t('consolidating'),
    consolidateHint: t('consolidateHint'),
    fork: t('fork'),
    forking: t('forking'),
    forkHint: t('forkHint'),
    sessionUnavailable: t('sessionUnavailable'),
    effort: t('effort'),
    effortQuick: t('effort_quick'),
    effortBalanced: t('effort_balanced'),
    effortThorough: t('effort_thorough'),
    thinking: t('thinking'),
    on: t('on'),
    off: t('off'),
    model: t('model'),
    modelInUse: t('modelInUse'),
    searchModels: t('searchModels'),
    filterModels: t('filterModels'),
    chooseModel: t('chooseModel'),
    noModels: t('noModels'),
    all: t('all'),
    categoryAuto: t('categoryAuto'),
    categoryByo: t('categoryByo'),
    categoryFree: t('categoryFree'),
    categoryPlan: t('categoryPlan'),
    categoryPaid: t('categoryPaid'),
    categoryConfigured: t('categoryConfigured'),
    // Present for type completeness and parity of wording: the browser cannot reach a
    // runtime on the user’s own machine, so this group only ever populates in the
    // editor. Keeping the strings here means the two hosts describe it identically if
    // the web app ever gains a route to one.
    categoryLocal: t('categoryLocal'),
    localDetail: t('localDetail'),
    autoDetail: t('autoDetail'),
    poolLabel: t('poolLabel'),
    poolDetail: t('poolDetail'),
    freeDetail: t('freeDetail'),
    planDetail: t('planDetail'),
    paidDetail: t('paidDetail'),
    configuredDetail: t('configuredDetail'),
    evermindLabel: t('evermindLabel'),
    evermindDetail: t('evermindDetail'),
    modelLocked: t('modelLocked'),
    accountSettings: t('accountSettings'),
    status: t('status'),
  }), [t, tModes]);
}
