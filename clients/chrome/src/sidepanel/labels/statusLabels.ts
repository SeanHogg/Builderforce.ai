/**
 * The Status tab's copy (plan, meters, Evermind) and the spend & savings readouts (the
 * chat's spend pill, the Status tab's period card), from Rovr's catalogs through
 * brain-ui's ONE key tables (`workStatusLabelsFrom`, `spendLabelsFrom`). This file only
 * says which Rovr message each canonical key reads. `{used}`, `{amount}`, `{pct}`… stay
 * in the messages as the shared components' own placeholders; they substitute the figures.
 * "Evermind" (a brand) and "v{version}" (a version tag) are not translated — brain-ui's
 * defaults stand for them.
 */
import { spendLabelsFrom, workStatusLabelsFrom, type SpendLabels, type WorkStatusLabels } from '@seanhogg/builderforce-brain-ui';
import type { MessageKey } from '../../i18n/t';
import { rovrLookup } from './rovrLookup';

export { formatCount } from './rovrLookup';

/** Status-tab canonical key → Rovr message. */
export const STATUS_KEY: Readonly<Record<string, MessageKey>> = {
  loading: 'stLoading',
  account: 'stAccount',
  plan: 'stPlan',
  resets: 'stResets',
  limitsLifted: 'stLimitsLifted',
  limitsLiftedHint: 'stLimitsLiftedHint',
  usage: 'stUsage',
  usageEmpty: 'stUsageEmpty',
  unlimited: 'stUnlimited',
  meterOf: 'stMeterOf',
  upgrade: 'stUpgrade',
  managePlan: 'stManagePlan',
  'billing.past_due': 'stBillingPastDue',
  'billing.canceled': 'stBillingCanceled',
  'billing.trialing': 'stBillingTrialing',
  'billing.incomplete': 'stBillingIncomplete',
  'plans.free': 'stPlanFree',
  'plans.pro': 'stPlanPro',
  'plans.teams': 'stPlanTeams',
  'plans.enterprise': 'stPlanEnterprise',
  'meters.ai_tokens': 'stMeterAiTokens',
  'meters.cloud_runs': 'stMeterCloudRuns',
  'meters.stage_sandbox_runs': 'stMeterSandboxRuns',
  'meters.ingestion': 'stMeterIngestion',
  'meters.error_events': 'stMeterErrorEvents',
  'meters.outbound_fetches': 'stMeterOutboundFetches',
  'meters.feedback_submissions': 'stMeterFeedback',
  'meters.replay_recordings': 'stMeterRecordings',
  'units.tokens': 'stUnitTokens',
  'units.bytes': 'stUnitBytes',
  'units.runs': 'stUnitRuns',
  'units.events': 'stUnitEvents',
  'units.fetches': 'stUnitFetches',
  'units.submissions': 'stUnitSubmissions',
  'units.sandbox_runs': 'stUnitRuns',
  'units.recordings': 'stUnitRecordings',
  evermindLearning: 'stEvermindLearning',
  evermindFrozen: 'stEvermindFrozen',
  evermindAnswersOn: 'stEvermindAnswersOn',
  evermindAnswersOff: 'stEvermindAnswersOff',
  evermindHint: 'stEvermindHint',
};

/** Spend canonical key → Rovr message. */
export const SPEND_KEY: Readonly<Record<string, MessageKey>> = {
  spent: 'spSpent',
  saved: 'spSaved',
  savedApprox: 'spSavedApprox',
  tokens: 'spTokens',
  pillTitle: 'spPillTitle',
  spendHeading: 'spSpendHeading',
  platform: 'spPlatform',
  yourKey: 'spYourKey',
  yourKeyHint: 'spYourKeyHint',
  unpriced: 'spUnpriced',
  savedHeading: 'spSavedHeading',
  savedShare: 'spSavedShare',
  estimated: 'spEstimated',
  measured: 'spMeasured',
  events: 'spEvents',
  nothingSaved: 'spNothingSaved',
  periodHeading: 'spPeriodHeading',
  'sources.prompt_cache': 'spSourcePromptCache',
  'sources.memory_answer': 'spSourceMemoryAnswer',
  'sources.evermind_answer': 'spSourceEvermindAnswer',
  'sources.response_cache': 'spSourceResponseCache',
  'sources.context_trim': 'spSourceContextTrim',
  'sources.recall_overhead': 'spSourceRecallOverhead',
  'sources.local_model': 'spSourceLocalModel',
  'sources.deterministic': 'spSourceDeterministic',
  'sourceHints.prompt_cache': 'spHintPromptCache',
  'sourceHints.memory_answer': 'spHintMemoryAnswer',
  'sourceHints.evermind_answer': 'spHintEvermindAnswer',
  'sourceHints.response_cache': 'spHintResponseCache',
  'sourceHints.context_trim': 'spHintContextTrim',
  'sourceHints.recall_overhead': 'spHintRecallOverhead',
  'sourceHints.local_model': 'spHintLocalModel',
  'sourceHints.deterministic': 'spHintDeterministic',
};

export function rovrStatusLabels(): WorkStatusLabels {
  return workStatusLabelsFrom(rovrLookup((key) => STATUS_KEY[key]));
}

export function rovrSpendLabels(): SpendLabels {
  return spendLabelsFrom(rovrLookup((key) => SPEND_KEY[key]));
}
