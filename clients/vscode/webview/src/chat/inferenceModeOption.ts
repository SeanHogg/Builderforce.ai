/**
 * The editor's inference mode as the shared composer and banner read it. The host owns
 * the mode (`src/inferenceModeSetting.ts`) and carries it in `init`; a pick is posted
 * back (`setInferenceMode`) and returns in the next `init`, so the webview never stores
 * it. Never chosen — signed in or not — the composer holds the first turn behind the
 * first-run question: brain-ui's ONE wiring (`inferenceModeOption`), the same rule the
 * web and Rovr ask by.
 */
import { inferenceModeOption, modelRemedies as sharedModelRemedies, type ModelRemedies, type PromptOptionsInferenceMode } from '@seanhogg/builderforce-brain-ui';
import { post, type InitData } from '../vscodeBridge';

export function webviewInferenceMode(init: InitData): PromptOptionsInferenceMode | undefined {
  if (!init.inferenceMode) return undefined;
  return inferenceModeOption({
    value: init.inferenceMode,
    chosen: !!init.inferenceModeChosen,
    onChange: (mode) => post('setInferenceMode', { mode }),
  });
}

/**
 * The banner's remedies for the verdicts signing in would not fix — brain-ui's ONE
 * derivation (`modelRemedies`) over the editor's ports: the mode is posted to the host,
 * and "Download a local model" opens the host's model picker (`downloadLocalModel`).
 * "Pick a model" opens THIS composer's `/` menu on its Model tab (`composerId`).
 */
export function modelRemedies(init: InitData | undefined, composerId: string, onDismiss: () => void, retry?: () => void): ModelRemedies {
  return sharedModelRemedies({
    mode: init?.inferenceMode,
    setMode: (mode) => post('setInferenceMode', { mode }),
    composerId,
    onDismiss,
    downloadLocalModel: () => post('downloadLocalModel'),
    // "Switch to Hybrid" re-sends the refused turn (`conv.retryLastTurn`) — posted after
    // the mode, so the host applies Hybrid before the run starts.
    ...(retry ? { retry } : {}),
  });
}
