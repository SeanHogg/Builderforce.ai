/**
 * THE remedies for the shared banner's "nothing can take this turn, and signing in would
 * not help" verdicts — `no_local_model`, `no_specific_model`, and an on-device model that
 * keeps crashing — derived ONCE for every host (the web Brain, the guest panel, the
 * canvas's Brain object, the VS Code webview, Rovr). Each host used to spell the same
 * three rules out itself, and each spelled them slightly differently (one dismissed the
 * banner, one did not; none re-sent the refused turn after moving onto Hybrid).
 *
 *   - "Switch to Hybrid" — offered only while Local only is what rules the cloud out. It
 *     applies the mode FIRST, then re-sends the refused turn when the host can (`retry`),
 *     so the person's request is answered rather than left for them to type again.
 *   - "Download a local model" — the host's download place when it has one (the editor's
 *     model picker, Rovr's settings), else this composer's `/` menu on its Model tab.
 *   - "Pick a model" — this composer's `/` menu on its Model tab (Run models + the picker).
 *
 * Every remedy dismisses the banner: the menu or the new mode is now the answer to it.
 * The menu opened is the one beside the banner (`composerId`), never every composer on
 * the page. The host's own mode and where-to-download are its ports — nothing else here
 * is per host.
 */
import type { InferenceMode } from '@seanhogg/builderforce-brain-embedded';
import type { ChatErrorBannerProps } from '../ChatErrorBanner';
import type { PromptOptionsInferenceMode } from './InferenceModeControl';
import { requestComposerMenu } from '../promptOptions/composerMenuRequest';

export interface ModelRemedyPorts {
  /** The mode in force, or undefined while the host has not read it yet. */
  mode: InferenceMode | undefined;
  /** Apply a mode — the same handler the `/` menu's Run models control calls. */
  setMode: (mode: InferenceMode) => void | Promise<void>;
  /** The composer beside the banner — its `/` menu is the one the remedies open. */
  composerId: string;
  /** Clear the banner (the run's error). */
  onDismiss: () => void;
  /** Where this host downloads an on-device model; omitted ⇒ the composer's Model tab. */
  downloadLocalModel?: () => void;
  /** Re-send the turn the verdict refused, once the mode has moved. Omitted ⇒ not re-sent. */
  retry?: () => void;
}

export type ModelRemedies = Pick<ChatErrorBannerProps, 'onSwitchToHybrid' | 'onDownloadLocalModel' | 'onPickModel'>;

export function modelRemedies({ mode, setMode, composerId, onDismiss, downloadLocalModel, retry }: ModelRemedyPorts): ModelRemedies {
  const openModelTab = () => requestComposerMenu(composerId, 'model');
  return {
    ...(mode === 'local-only'
      ? {
          onSwitchToHybrid: () => {
            onDismiss();
            // Re-sent whether or not applying the mode's side effects settled cleanly (an
            // anonymous Hybrid opt-in mints its allowance there): the choice is stored
            // first, and the re-sent turn reports its own failure if the cloud is still out.
            const resend = () => retry?.();
            void Promise.resolve(setMode('hybrid')).then(resend, resend);
          },
        }
      : {}),
    onDownloadLocalModel: () => {
      (downloadLocalModel ?? openModelTab)();
      onDismiss();
    },
    onPickModel: () => {
      openModelTab();
      onDismiss();
    },
  };
}

/**
 * THE composer wiring for a host's mode — every host hands the shared composer the same
 * shape from the same three facts. `needsChoice` is "never chosen", signed in OR
 * anonymous (operator decision): the first-run question asks everyone once, and for an
 * anonymous person it is the Hybrid opt-in. Who is signed in decides the DEFAULT `value`
 * (the host's derivation), never whether the person is asked.
 */
export function inferenceModeOption(state: {
  value: InferenceMode;
  chosen: boolean;
  onChange: PromptOptionsInferenceMode['onChange'];
}): PromptOptionsInferenceMode {
  return { value: state.value, onChange: state.onChange, needsChoice: !state.chosen };
}
