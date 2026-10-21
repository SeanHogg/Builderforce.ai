/**
 * The shared composer's copy (`BrainComposer` — the prompt box, its `+` menu, the `/`
 * Work panel's Mode / Effort / Model / Status tabs, the @-mention and #-ticket pickers),
 * from Rovr's own catalogs (`chrome.i18n`) through brain-ui's ONE key table
 * (`brainComposerLabelsFrom`), which also holds the English. This file only says which
 * Rovr message each canonical key reads; parameterised copy gets Chrome's `$1` with the
 * figure formatted for the panel's locale (`rovrLookup`).
 */
import {
  LOCAL_MODEL_LABEL_FIELDS,
  brainComposerLabelsFrom,
  type BrainComposerLabels,
  type LocalModelLabels,
} from '@seanhogg/builderforce-brain-ui';
import type { MessageKey } from '../../i18n/t';
import { rovrLocalModelKey } from './localModelLabels';
import { rovrLookup } from './rovrLookup';
import { SPEND_KEY, STATUS_KEY } from './statusLabels';

/** Why project memory cannot stand behind the chat right now (null: it can). */
export type MemoryGap = 'signedOut' | 'noProject' | null;

const COMPOSER_KEY: Readonly<Record<string, MessageKey>> = {
  placeholder: 'composerPlaceholder',
  add: 'cmpAdd',
  upload: 'cmpUpload',
  uploading: 'cmpUploading',
  addContext: 'cmpAddContext',
  browseWeb: 'cmpBrowseWeb',
  on: 'cmpOn',
  off: 'cmpOff',
  remove: 'remove',
  send: 'send',
  queueSend: 'cmpQueueSend',
  stop: 'stop',
  dictate: 'cmpDictate',
  stopDictation: 'cmpStopDictation',
  'modeLabel.chat': 'cmpModeChat',
  'modeLabel.work': 'cmpModeWork',
  'modeHint.chat': 'cmpModeChatHint',
  'modeHint.work': 'cmpModeWorkHint',
  memoryOnHint: 'cmpMemoryOnHint',
  memoryOffHint: 'cmpMemoryOffHint',
  autoModeHint: 'cmpAutoModeHint',
  'effortDesc.quick': 'cmpEffortQuickDesc',
  'effortDesc.balanced': 'cmpEffortBalancedDesc',
  'effortDesc.thorough': 'cmpEffortThoroughDesc',
  effortThinkingSuffix: 'cmpEffortThinkingSuffix',
  thinkingOnDesc: 'cmpThinkingOnDesc',
  thinkingOffDesc: 'cmpThinkingOffDesc',
};

const OPTIONS_KEY: Readonly<Record<string, MessageKey>> = {
  categoryAuto: 'optCategoryAuto',
  categoryByo: 'optCategoryByo',
  categoryFree: 'optCategoryFree',
  categoryPlan: 'optCategoryPlan',
  categoryPaid: 'optCategoryPaid',
  categoryConfigured: 'optCategoryConfigured',
  categoryLocal: 'optCategoryLocal',
  // Rovr's automatic route is local first, then the gateway — say so, not the web's.
  autoDetail: 'modelAutoHint',
  poolLabel: 'optPoolLabel',
  poolDetail: 'optPoolDetail',
  freeDetail: 'optFreeDetail',
  planDetail: 'optPlanDetail',
  paidDetail: 'optPaidDetail',
  paidCostDetail: 'optPaidCostDetail',
  byoDetail: 'optByoDetail',
  configuredDetail: 'optConfiguredDetail',
  localDetail: 'optLocalDetail',
  evermindLabel: 'optEvermindLabel',
  evermindDetail: 'optEvermindDetail',
  options: 'optOptions',
  mode: 'optMode',
  memory: 'optMemory',
  autoMode: 'optAutoMode',
  autoModeHint: 'cmpAutoModeHint',
  conversation: 'optConversation',
  consolidate: 'optConsolidate',
  consolidating: 'optConsolidating',
  consolidateHint: 'optConsolidateHint',
  fork: 'optFork',
  forking: 'optForking',
  forkHint: 'optForkHint',
  sessionUnavailable: 'optSessionUnavailable',
  effort: 'optEffort',
  effortQuick: 'optEffortQuick',
  effortBalanced: 'optEffortBalanced',
  effortThorough: 'optEffortThorough',
  thinking: 'optThinking',
  on: 'cmpOn',
  off: 'cmpOff',
  model: 'modelHeading',
  modelInUse: 'optModelInUse',
  searchModels: 'optSearchModels',
  filterModels: 'optFilterModels',
  chooseModel: 'optChooseModel',
  noModels: 'optNoModels',
  all: 'optAll',
  modelLocked: 'optModelLocked',
  accountSettings: 'optAccountSettings',
  status: 'optStatus',
  // Where models run — the Model tab's control and the first-run question.
  inferenceMode: 'optInferenceMode',
  inferenceModeHybrid: 'optInferenceModeHybrid',
  inferenceModeHybridHint: 'optInferenceModeHybridHint',
  inferenceModeLocalOnly: 'optInferenceModeLocalOnly',
  inferenceModeLocalOnlyHint: 'optInferenceModeLocalOnlyHint',
  inferenceModeSpecific: 'optInferenceModeSpecific',
  inferenceModeSpecificHint: 'optInferenceModeSpecificHint',
  inferenceModeRecommended: 'optInferenceModeRecommended',
  inferenceModeAskTitle: 'optInferenceModeAskTitle',
  inferenceModeAskBody: 'optInferenceModeAskBody',
};

const PICKER_KEY: Readonly<Record<string, MessageKey>> = {
  'mention.title': 'mnTitle',
  'mention.agent': 'mnAgent',
  'mention.human': 'mnHuman',
  'ticket.title': 'mnTicketTitle',
  'ticket.status': 'mnTicketStatus',
  'ticket.noMatches': 'mnTicketNoMatches',
};

const isLocalModelField = (key: string): key is keyof LocalModelLabels =>
  (LOCAL_MODEL_LABEL_FIELDS as readonly string[]).includes(key);

/** Which Rovr message one of brain-ui's scoped composer keys reads. */
export function composerMessageKey(scoped: string, memoryGap: MemoryGap): MessageKey | undefined {
  const dot = scoped.indexOf('.');
  const part = scoped.slice(0, dot);
  const key = scoped.slice(dot + 1);
  switch (part) {
    case 'composer':
      if (key === 'memoryUnavailable') return memoryGap === 'signedOut' ? 'cmpMemoryNeedsSignIn' : 'cmpMemoryNeedsProject';
      return COMPOSER_KEY[key];
    case 'options':
      // The on-device list's fields read Rovr's `lm*` keys (`localModelLabels.ts`).
      return OPTIONS_KEY[key] ?? (isLocalModelField(key) ? rovrLocalModelKey(key) : undefined);
    case 'status': return STATUS_KEY[key];
    case 'spend': return SPEND_KEY[key];
    default: return PICKER_KEY[scoped];
  }
}

/** Everything `BrainComposer` renders, in the panel's language. */
export function rovrComposerLabels(memoryGap: MemoryGap): BrainComposerLabels {
  return brainComposerLabelsFrom(rovrLookup((key) => composerMessageKey(key, memoryGap)));
}
