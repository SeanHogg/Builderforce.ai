/**
 * The editor's inference mode as the shared composer and banner read it. The host owns
 * the mode (`src/inferenceModeSetting.ts`) and carries it in `init`; a pick is posted
 * back (`setInferenceMode`) and returns in the next `init`, so the webview never stores
 * it. Signed in with no mode chosen, the composer holds the first turn behind the
 * first-run question.
 */
import { requestComposerMenu, type PromptOptionsInferenceMode } from '@seanhogg/builderforce-brain-ui';
import { post, type InitData } from '../vscodeBridge';

export function webviewInferenceMode(init: InitData): PromptOptionsInferenceMode | undefined {
  if (!init.inferenceMode) return undefined;
  return {
    value: init.inferenceMode,
    onChange: (mode) => post('setInferenceMode', { mode }),
    needsChoice: init.signedIn && !init.inferenceModeChosen,
  };
}

/**
 * The banner's remedies for the two verdicts signing in would not fix: `no_local_model`
 * (Hybrid only while on Local only; the host's model picker downloads a local model) and
 * `no_specific_model` (this composer's `/` menu on its Model tab — `composerId` names the
 * composer beside the banner, so only that one opens).
 */
export function modelRemedies(
  init: InitData | undefined,
  composerId: string,
  onDismiss: () => void,
): { onSwitchToHybrid?: () => void; onDownloadLocalModel: () => void; onPickModel: () => void } {
  return {
    ...(init?.inferenceMode === 'local-only' ? { onSwitchToHybrid: () => post('setInferenceMode', { mode: 'hybrid' }) } : {}),
    onDownloadLocalModel: () => post('downloadLocalModel'),
    onPickModel: () => {
      requestComposerMenu(composerId, 'model');
      onDismiss();
    },
  };
}
