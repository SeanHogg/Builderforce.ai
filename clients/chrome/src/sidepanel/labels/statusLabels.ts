/**
 * The Status tab's copy (plan, meters, Evermind) and the spend & savings readouts (the
 * chat's spend pill, the Status tab's period card), from Rovr's catalogs. `{used}`,
 * `{amount}`, `{pct}`… stay in the messages as the shared components' own placeholders;
 * they substitute the figures.
 */
import type { SpendLabels, WorkStatusLabels } from '@seanhogg/builderforce-brain-ui';
import { t } from '../../i18n/t';

/** A count in the panel's locale (token budgets, ticket counts). */
export const formatCount = (n: number): string => n.toLocaleString(chrome.i18n.getUILanguage());

export function rovrStatusLabels(): WorkStatusLabels {
  return {
    loading: t('stLoading'),
    account: t('stAccount'),
    plan: t('stPlan'),
    resets: t('stResets'),
    limitsLifted: t('stLimitsLifted'),
    limitsLiftedHint: t('stLimitsLiftedHint'),
    usage: t('stUsage'),
    usageEmpty: t('stUsageEmpty'),
    unlimited: t('stUnlimited'),
    meterOf: t('stMeterOf'),
    upgrade: t('stUpgrade'),
    managePlan: t('stManagePlan'),
    billing: {
      past_due: t('stBillingPastDue'),
      canceled: t('stBillingCanceled'),
      trialing: t('stBillingTrialing'),
      incomplete: t('stBillingIncomplete'),
    },
    plans: {
      free: t('stPlanFree'),
      pro: t('stPlanPro'),
      teams: t('stPlanTeams'),
      enterprise: t('stPlanEnterprise'),
    },
    meters: {
      ai_tokens: t('stMeterAiTokens'),
      cloud_runs: t('stMeterCloudRuns'),
      stage_sandbox_runs: t('stMeterSandboxRuns'),
      ingestion: t('stMeterIngestion'),
      error_events: t('stMeterErrorEvents'),
      outbound_fetches: t('stMeterOutboundFetches'),
      feedback_submissions: t('stMeterFeedback'),
      replay_recordings: t('stMeterRecordings'),
    },
    units: {
      tokens: t('stUnitTokens'),
      bytes: t('stUnitBytes'),
      runs: t('stUnitRuns'),
      events: t('stUnitEvents'),
      fetches: t('stUnitFetches'),
      submissions: t('stUnitSubmissions'),
      sandbox_runs: t('stUnitRuns'),
      recordings: t('stUnitRecordings'),
    },
    // A brand name and a version tag — not translated.
    evermind: 'Evermind',
    evermindVersion: 'v{version}',
    evermindLearning: t('stEvermindLearning'),
    evermindFrozen: t('stEvermindFrozen'),
    evermindAnswersOn: t('stEvermindAnswersOn'),
    evermindAnswersOff: t('stEvermindAnswersOff'),
    evermindHint: t('stEvermindHint'),
  };
}

export function rovrSpendLabels(): SpendLabels {
  return {
    spent: t('spSpent'),
    saved: t('spSaved'),
    savedApprox: t('spSavedApprox'),
    tokens: t('spTokens'),
    pillTitle: t('spPillTitle'),
    spendHeading: t('spSpendHeading'),
    platform: t('spPlatform'),
    yourKey: t('spYourKey'),
    yourKeyHint: t('spYourKeyHint'),
    unpriced: t('spUnpriced'),
    savedHeading: t('spSavedHeading'),
    savedShare: t('spSavedShare'),
    estimated: t('spEstimated'),
    measured: t('spMeasured'),
    events: t('spEvents'),
    nothingSaved: t('spNothingSaved'),
    periodHeading: t('spPeriodHeading'),
    sources: {
      prompt_cache: t('spSourcePromptCache'),
      memory_answer: t('spSourceMemoryAnswer'),
      evermind_answer: t('spSourceEvermindAnswer'),
      response_cache: t('spSourceResponseCache'),
      context_trim: t('spSourceContextTrim'),
      recall_overhead: t('spSourceRecallOverhead'),
    },
    sourceHints: {
      prompt_cache: t('spHintPromptCache'),
      memory_answer: t('spHintMemoryAnswer'),
      evermind_answer: t('spHintEvermindAnswer'),
      response_cache: t('spHintResponseCache'),
      context_trim: t('spHintContextTrim'),
      recall_overhead: t('spHintRecallOverhead'),
    },
  };
}
