/**
 * A model pick made in the EXTENSION HOST — the "Select BuilderForce model" QuickPick, its
 * signed-out on-device list, Kimi connect — applied the way the `/` menu applies one: the
 * inference mode moves with the pick (brain-embedded `inferenceModeForModelPick`, the ONE
 * rule every host runs), then the model is set. Without it a pick made under Hybrid was
 * only tried and could be answered by another model.
 *
 * The webview's `/` menu applies the rule itself (brain-ui `ModelPane`) and posts the mode
 * before the model, so its `model.set` sets the model directly. A pin the extension clears
 * on its own (entitlement) is not a pick either: it never moves the mode.
 */
import { inferenceModeForModelPick, type ChatModelSelection } from "@seanhogg/builderforce-brain-embedded";
import { inferenceModeState, setInferenceMode } from "./inferenceModeSetting";
import { setSelectedModel, setSelectedModelPool } from "./modelState";

export function applyModelPick(selection: ChatModelSelection): void {
  const { mode, chosen } = inferenceModeState();
  const next = inferenceModeForModelPick(mode, selection, { undecided: !chosen });
  // The mode applies in memory at once (`setInferenceMode`), so the next turn runs in it;
  // a failed settings write leaves the mode as it was.
  if (next) void setInferenceMode(next).catch(() => undefined);
  if (selection.mode === "byo_pool") setSelectedModelPool();
  else setSelectedModel(selection.mode === "model" ? selection.model : undefined);
}
