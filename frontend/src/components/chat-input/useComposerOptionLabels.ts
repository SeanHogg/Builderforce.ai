import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { localModelLabelsFrom, type PromptOptionsLabels } from '@seanhogg/builderforce-brain-ui';
import { useChatModeCopy } from '@/lib/brain/useChatModeCopy';

/** The on-device list's row placeholders, handed through LITERALLY so the shared list
 *  fills them per row (formatting a template with no value throws FORMATTING_ERROR). */
const LOCAL_LIST_PLACEHOLDERS = { size: '{size}', percent: '{percent}', tokens: '{tokens}' } as const;

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
  const { pickerAria } = useChatModeCopy();
  return useMemo<Partial<PromptOptionsLabels>>(() => ({
    options: t('options'),
    mode: pickerAria,
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
    // The on-device group: models this browser runs itself (WebGPU `bfi`, WebLLM),
    // downloaded from the picker. The editor's group also lists runtimes on the machine.
    categoryLocal: t('categoryLocal'),
    // A TEMPLATE, not a sentence: `modelChoice` fills `{runtime}` per model, so the
    // placeholder is handed through as its own value. Formatting it with none threw
    // FORMATTING_ERROR on every composer mount.
    localDetail: t('localDetail', { runtime: '{runtime}' }),
    // The on-device list (models this browser runs on WebGPU), through brain-ui's ONE
    // key table — the `chatInput` keys ARE its field names. The size, percentage and
    // window placeholders are TEMPLATES the shared list fills per row, handed through
    // literally for the same reason as `localDetail`.
    ...localModelLabelsFrom((field) => t(field, LOCAL_LIST_PLACEHOLDERS)),
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
  }), [t, pickerAria]);
}
