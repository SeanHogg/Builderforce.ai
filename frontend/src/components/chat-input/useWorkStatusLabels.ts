// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { WorkStatusLabels } from '@seanhogg/builderforce-brain-ui';

const BILLING = ['past_due', 'canceled', 'trialing', 'incomplete'] as const;
const PLANS = ['free', 'pro', 'teams', 'enterprise'] as const;
/** The server's meter keys — named once, in `usageMeter.meter`, for every usage readout. */
const METERS = ['ai_tokens', 'cloud_runs', 'stage_sandbox_runs', 'ingestion', 'error_events', 'outbound_fetches', 'feedback_submissions', 'replay_recordings'] as const;
const UNITS = ['tokens', 'bytes', 'runs', 'events', 'fetches', 'submissions', 'sandbox_runs', 'recordings'] as const;

/**
 * The `/` menu's Status tab copy (plan, meters, Evermind), from the `workStatus`
 * catalog — reusing the strings the web already owns for the same facts: the meter
 * names and "Unlimited" from `usageMeter`, the Evermind posture from `evermindStatus`.
 * `{used}`/`{limit}`/`{unit}`/`{version}` are filled by the shared panel, so they are
 * handed through literally.
 */
export function useWorkStatusLabels(): Partial<WorkStatusLabels> {
  const t = useTranslations('workStatus');
  const tUsage = useTranslations('usageMeter');
  const tEvermind = useTranslations('evermindStatus');
  return useMemo<Partial<WorkStatusLabels>>(() => ({
    loading: t('loading'),
    account: t('account'),
    plan: t('plan'),
    resets: t('resets'),
    limitsLifted: t('limitsLifted'),
    limitsLiftedHint: t('limitsLiftedHint'),
    usage: tUsage('title'),
    usageEmpty: t('usageEmpty'),
    unlimited: tUsage('unlimited'),
    meterOf: t('meterOf', { used: '{used}', limit: '{limit}', unit: '{unit}' }),
    upgrade: t('upgrade'),
    managePlan: t('managePlan'),
    billing: Object.fromEntries(BILLING.map((k) => [k, t(`billing.${k}`)])),
    plans: Object.fromEntries(PLANS.map((k) => [k, t(`plans.${k}`)])),
    meters: Object.fromEntries(METERS.map((k) => [k, tUsage(`meter.${k}`)])),
    units: Object.fromEntries(UNITS.map((k) => [k, t(`units.${k}`)])),
    evermind: tEvermind('label'),
    evermindVersion: t('evermindVersion', { version: '{version}' }),
    evermindLearning: tEvermind('learning'),
    evermindFrozen: tEvermind('frozen'),
    evermindAnswersOn: t('evermindAnswersOn'),
    evermindAnswersOff: t('evermindAnswersOff'),
    evermindHint: t('evermindHint'),
  }), [t, tUsage, tEvermind]);
}
