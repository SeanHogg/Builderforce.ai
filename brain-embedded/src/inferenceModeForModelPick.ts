/**
 * THE mode a model pick implies — so the model a person picks is the model that runs, on
 * every host and from every picker (the `/` menu, the editor's QuickPick, Kimi connect).
 *
 * Hybrid only TRIES a pick (`createHostModelStream`: never hard-pinned, so the gateway may
 * fail it over and the turn falls back to Auto), and Local only sets aside any pick that
 * leaves the device. A pick left under either read as "picked Kimi, got MiniMax" while the
 * mode control still showed the old mode. So a pick moves the mode with it:
 *
 *   - a model or "your connected accounts" ⇒ Specific (hard-pinned, no fallback);
 *   - Auto while on Specific ⇒ Hybrid (Specific with nothing picked is `no_specific_model`);
 *   - an ON-DEVICE pick under Local only keeps Local only — it already runs as picked.
 *     On-device is the registry's `onDevice` (`runsOnDevice`), the same rule the stream
 *     applies, so a Kimi Code pick (local grammar, hosted) is NOT on-device;
 *   - UNDECIDED Local only (the person never chose; for an anonymous web visitor that
 *     question is the Hybrid opt-in) is never lifted by a pick: the first-run question
 *     still holds the next turn and asks.
 *
 * Returns the mode to switch to, or null when the mode in force already honours the pick.
 * Pure — the host applies it through its own mode setter.
 */
import type { InferenceMode } from '@builderforce/local-first';
import { runsOnDevice } from '@builderforce/local-inference';
import type { ChatModelSelection } from './modelChoice';

export function inferenceModeForModelPick(
  current: InferenceMode,
  selection: ChatModelSelection,
  options: { undecided?: boolean } = {},
): InferenceMode | null {
  if (selection.mode === 'auto') return current === 'specific' ? 'hybrid' : null;
  if (current === 'local-only') {
    if (selection.mode === 'model' && runsOnDevice(selection.model)) return null;
    if (options.undecided) return null;
  }
  return current === 'specific' ? null : 'specific';
}
