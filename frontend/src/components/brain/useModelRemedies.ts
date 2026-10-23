// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary.

import { useTranslations } from 'next-intl';
import { modelRemedies, type ChatErrorBannerProps } from '@seanhogg/builderforce-brain-ui';
import { useWebInferenceMode } from '@/lib/localFirst/useWebInferenceMode';

type Remedies = Pick<ChatErrorBannerProps, 'onSwitchToHybrid' | 'onDownloadLocalModel' | 'onPickModel'> & {
  labels: Pick<
    NonNullable<ChatErrorBannerProps['labels']>,
    | 'noLocalModel'
    | 'switchToHybrid'
    | 'downloadLocalModel'
    | 'noSpecificModel'
    | 'pickModel'
    | 'engineCrashed'
    | 'engineDetached'
    | 'modelKeepsCrashing'
    | 'manageLocalModels'
    | 'platformRefusedMode'
    | 'platformRefusedSync'
    | 'platformRefusedSetting'
  >;
};

/**
 * THE web's remedies for the shared banner's "nothing can take this turn, and signing
 * in would not help" verdicts, for every web surface that renders `ChatErrorBanner` (the
 * signed-in Brain, the guest panel, and the canvas's Brain object):
 *
 *   - `no_local_model` — "Switch to Hybrid" (only when Local only is what rules the cloud
 *     out; it re-sends the refused turn when the surface passes `retry`) and "Download a
 *     local model";
 *   - `no_specific_model` — "Pick a model";
 *   - `local_engine_failed` — the engine failure named in the person's language, and for a
 *     model that keeps crashing "Pick a model" + "Manage on-device models".
 *
 * The handlers are brain-ui's ONE derivation (`modelRemedies`) over the web's mode; the
 * menu remedies open the `/` menu's Model tab of the composer `composerId` names — the
 * one beside the banner that raised it, never every composer on the page.
 */
export function useModelRemedies(onDismiss: () => void, composerId: string, retry?: () => void): Remedies {
  const t = useTranslations('brain');
  const inference = useWebInferenceMode();
  return {
    ...modelRemedies({ mode: inference.value, setMode: inference.onChange, composerId, onDismiss, ...(retry ? { retry } : {}) }),
    labels: {
      noLocalModel: t('noLocalModel'),
      switchToHybrid: t('switchToHybrid'),
      downloadLocalModel: t('downloadLocalModel'),
      noSpecificModel: t('noSpecificModel'),
      pickModel: t('pickModel'),
      // An on-device engine that crashed, went away mid-answer, or keeps crashing on one
      // model (`local_engine_failed`); the last offers "Pick a model" and "Manage
      // on-device models" — both open the same Model tab, where the model is removed.
      engineCrashed: t('engineCrashed'),
      engineDetached: t('engineDetached'),
      modelKeepsCrashing: t('modelKeepsCrashing'),
      manageLocalModels: t('manageLocalModels'),
      // A platform call this run needed was refused (`platform_refused`): by Local only,
      // by account sync being off, or by another platform setting.
      platformRefusedMode: t('platformRefusedMode'),
      platformRefusedSync: t('platformRefusedSync'),
      platformRefusedSetting: t('platformRefusedSetting'),
    },
  };
}
