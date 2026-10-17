/**
 * The shared composer's copy (`BrainComposer` — the prompt box, its `+` menu, the `/`
 * Work panel's Mode / Effort / Model / Status tabs, the @-mention and #-ticket pickers),
 * from Rovr's own catalogs (`chrome.i18n`). ONE mapping — the composer, the Work panel and
 * the Status tab all take their bundle from here, so no Rovr view hands the shared
 * component a sentence of its own. Parameterised copy is rendered here (Chrome's `$1`),
 * with the figure formatted for the panel's locale.
 */
import type { BrainComposerLabels, ComposerLabels, PromptOptionsLabels } from '@seanhogg/builderforce-brain-ui';
import type { ChatMode, Effort } from '@seanhogg/builderforce-brain-embedded';
import { t, type MessageKey } from '../../i18n/t';
import { rovrLocalModelLabels } from './localModelLabels';
import { formatCount, rovrSpendLabels, rovrStatusLabels } from './statusLabels';

/** Why project memory cannot stand behind the chat right now (null: it can). */
export type MemoryGap = 'signedOut' | 'noProject' | null;

const MODE_LABEL: Record<ChatMode, MessageKey> = { chat: 'cmpModeChat', work: 'cmpModeWork' };
const MODE_HINT: Record<ChatMode, MessageKey> = { chat: 'cmpModeChatHint', work: 'cmpModeWorkHint' };
const EFFORT_DESC: Record<Effort, MessageKey> = {
  quick: 'cmpEffortQuickDesc',
  balanced: 'cmpEffortBalancedDesc',
  thorough: 'cmpEffortThoroughDesc',
};

function composerCopy(memoryGap: MemoryGap): ComposerLabels {
  return {
    placeholder: t('composerPlaceholder'),
    add: t('cmpAdd'),
    upload: t('cmpUpload'),
    uploading: t('cmpUploading'),
    addContext: t('cmpAddContext'),
    browseWeb: t('cmpBrowseWeb'),
    on: t('cmpOn'),
    off: t('cmpOff'),
    remove: t('remove'),
    send: t('send'),
    queueSend: t('cmpQueueSend'),
    stop: t('stop'),
    dictate: t('cmpDictate'),
    stopDictation: t('cmpStopDictation'),
    modeLabel: (mode) => t(MODE_LABEL[mode]),
    modeHint: (mode) => t(MODE_HINT[mode]),
    memoryOnHint: t('cmpMemoryOnHint'),
    memoryOffHint: t('cmpMemoryOffHint'),
    memoryUnavailable: memoryGap === 'signedOut' ? t('cmpMemoryNeedsSignIn') : t('cmpMemoryNeedsProject'),
    autoModeHint: t('cmpAutoModeHint'),
    effortDesc: (level, answerTokens) => t(EFFORT_DESC[level], formatCount(answerTokens)),
    effortThinkingSuffix: (thinkingTokens) => t('cmpEffortThinkingSuffix', formatCount(thinkingTokens)),
    thinkingOnDesc: (budgetTokens) => t('cmpThinkingOnDesc', formatCount(budgetTokens)),
    thinkingOffDesc: t('cmpThinkingOffDesc'),
  };
}

function optionsCopy(): PromptOptionsLabels {
  return {
    ...rovrLocalModelLabels(),
    categoryAuto: t('optCategoryAuto'),
    categoryByo: t('optCategoryByo'),
    categoryFree: t('optCategoryFree'),
    categoryPlan: t('optCategoryPlan'),
    categoryPaid: t('optCategoryPaid'),
    categoryConfigured: t('optCategoryConfigured'),
    categoryLocal: t('optCategoryLocal'),
    // Rovr's automatic route is local first, then the gateway — say so, not the web's.
    autoDetail: t('modelAutoHint'),
    poolLabel: t('optPoolLabel'),
    poolDetail: t('optPoolDetail'),
    freeDetail: t('optFreeDetail'),
    planDetail: t('optPlanDetail'),
    paidDetail: t('optPaidDetail'),
    paidCostDetail: t('optPaidCostDetail'),
    byoDetail: t('optByoDetail'),
    configuredDetail: t('optConfiguredDetail'),
    localDetail: t('optLocalDetail'),
    evermindLabel: t('optEvermindLabel'),
    evermindDetail: t('optEvermindDetail'),
    options: t('optOptions'),
    mode: t('optMode'),
    memory: t('optMemory'),
    autoMode: t('optAutoMode'),
    autoModeHint: t('cmpAutoModeHint'),
    conversation: t('optConversation'),
    consolidate: t('optConsolidate'),
    consolidating: t('optConsolidating'),
    consolidateHint: t('optConsolidateHint'),
    fork: t('optFork'),
    forking: t('optForking'),
    forkHint: t('optForkHint'),
    sessionUnavailable: t('optSessionUnavailable'),
    effort: t('optEffort'),
    effortQuick: t('optEffortQuick'),
    effortBalanced: t('optEffortBalanced'),
    effortThorough: t('optEffortThorough'),
    thinking: t('optThinking'),
    on: t('cmpOn'),
    off: t('cmpOff'),
    model: t('modelHeading'),
    modelInUse: t('optModelInUse'),
    searchModels: t('optSearchModels'),
    filterModels: t('optFilterModels'),
    chooseModel: t('optChooseModel'),
    noModels: t('optNoModels'),
    all: t('optAll'),
    modelLocked: t('optModelLocked'),
    accountSettings: t('optAccountSettings'),
    status: t('optStatus'),
  };
}

/** Everything `BrainComposer` renders, in the panel's language. */
export function rovrComposerLabels(memoryGap: MemoryGap): BrainComposerLabels {
  return {
    composer: composerCopy(memoryGap),
    options: optionsCopy(),
    status: rovrStatusLabels(),
    spend: rovrSpendLabels(),
    mention: { title: t('mnTitle'), agent: t('mnAgent'), human: t('mnHuman') },
    ticket: { title: t('mnTicketTitle'), status: t('mnTicketStatus'), noMatches: t('mnTicketNoMatches') },
  };
}
