/**
 * The copy of the INFERENCE MODE control (the `/` menu's Model tab) and its first-run
 * prompt — the same strings on the web app, Rovr and the VS Code webview. Hosts read them
 * through the `/` menu's key table (`promptOptionsLabelsFrom` — these fields are part of
 * `PromptOptionsLabels`), so a host maps each canonical key onto its own catalog once.
 */
import type { InferenceMode } from '@seanhogg/builderforce-brain-embedded';

export interface InferenceModeLabels {
  /** Heading of the control in the Model tab. */
  inferenceMode: string;
  inferenceModeHybrid: string;
  inferenceModeHybridHint: string;
  inferenceModeLocalOnly: string;
  inferenceModeLocalOnlyHint: string;
  inferenceModeSpecific: string;
  inferenceModeSpecificHint: string;
  /** Tag beside the recommended mode. */
  inferenceModeRecommended: string;
  /** The first-run prompt's question. */
  inferenceModeAskTitle: string;
  /** One line under it: that the choice can be changed later, and where. */
  inferenceModeAskBody: string;
}

export const DEFAULT_INFERENCE_MODE_LABELS: InferenceModeLabels = {
  inferenceMode: 'Run models',
  inferenceModeHybrid: 'Hybrid',
  inferenceModeHybridHint: 'This device first, then BuilderForce cloud when it needs to',
  inferenceModeLocalOnly: 'Local only',
  inferenceModeLocalOnlyHint: 'Only models on this device — nothing is sent to the cloud',
  inferenceModeSpecific: 'Specific model',
  inferenceModeSpecificHint: 'The model you pick always runs — cloud, your connected accounts or one local model',
  inferenceModeRecommended: 'Recommended',
  inferenceModeAskTitle: 'How should BuilderForce run models?',
  inferenceModeAskBody: 'You can change this any time in the / menu, under Model.',
};

/** The canonical key fields, for a host's catalog-coverage test. */
export const INFERENCE_MODE_LABEL_FIELDS = Object.keys(DEFAULT_INFERENCE_MODE_LABELS) as ReadonlyArray<keyof InferenceModeLabels>;

const NAME: Readonly<Record<InferenceMode, keyof InferenceModeLabels>> = {
  hybrid: 'inferenceModeHybrid',
  'local-only': 'inferenceModeLocalOnly',
  specific: 'inferenceModeSpecific',
};
const HINT: Readonly<Record<InferenceMode, keyof InferenceModeLabels>> = {
  hybrid: 'inferenceModeHybridHint',
  'local-only': 'inferenceModeLocalOnlyHint',
  specific: 'inferenceModeSpecificHint',
};

/** A mode's name and one-line description. */
export function inferenceModeCopy(mode: InferenceMode, labels: InferenceModeLabels): { name: string; hint: string } {
  return { name: labels[NAME[mode]], hint: labels[HINT[mode]] };
}
