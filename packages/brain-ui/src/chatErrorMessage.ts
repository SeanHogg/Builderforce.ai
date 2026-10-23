/**
 * THE sentence a failed turn is shown with — ONE derivation for every place a failure is
 * read: the chat's error banner (`ChatErrorBanner`) and the transcript's error step row
 * (`timeline/StepRows` `ErrorRow`), on every host that renders them (web, canvas, the VS
 * Code webview, Rovr). The verdict (`chatErrorAction`) names the case; a verdict with a
 * sentence of its own replaces the raw sentinel (`no_local_model`, `bfi_engine_crashed`,
 * `platform_send_disabled`, …); anything else keeps the server's own words.
 */
import type { ChatErrorAction } from '@seanhogg/builderforce-brain-embedded';
import type { ChatErrorBannerLabels } from './ChatErrorBanner';

/** The sentence for an on-device engine failure, by its code. */
function engineMessage(code: ChatErrorAction['engineCode'], labels: ChatErrorBannerLabels, fallback: string): string {
  switch (code) {
    case 'bfi_engine_crashed':
      return labels.engineCrashed;
    case 'page_engine_detached':
      return labels.engineDetached;
    case 'model_keeps_crashing':
      return labels.modelKeepsCrashing;
    default:
      return fallback;
  }
}

/** The sentence for a refusal by the person's own platform policy, by the switch that
 *  governs it — the mode, account sync, or another advanced switch. */
function platformRefusedMessage(setting: ChatErrorAction['setting'], labels: ChatErrorBannerLabels): string {
  if (setting === 'synchronize') return labels.platformRefusedSync;
  if (setting === 'inferenceMode' || setting === undefined) return labels.platformRefusedMode;
  return labels.platformRefusedSetting;
}

export function chatErrorMessage(error: string, action: ChatErrorAction | null, labels: ChatErrorBannerLabels): string {
  switch (action?.kind) {
    case 'sign_in':
      return labels.noModel;
    case 'no_local_model':
      return labels.noLocalModel;
    case 'no_specific_model':
      return labels.noSpecificModel;
    case 'local_engine_failed':
      return engineMessage(action.engineCode, labels, error);
    case 'platform_refused':
      return platformRefusedMessage(action.setting, labels);
    default:
      return error;
  }
}
