/**
 * The copy of the on-device model list — the page engines' catalog rows a person
 * downloads, runs and removes. Hosts pass their own localized bundle (the web app via
 * next-intl, the editor webview via `vscode.l10n`, Rovr via `chrome.i18n`); the English
 * defaults keep the list readable unmapped. Model and engine names are brands and come
 * from the catalog untranslated.
 *
 * Placeholders are substituted by the list itself: `{size}` (a formatted byte count),
 * `{percent}` (0–100), `{tokens}` (a formatted context window) and `{count}` (a number
 * of models).
 */
import type { LocalModelRow, LocalPickerGroup } from '@seanhogg/builderforce-brain-embedded';
import { stringsFrom } from '../labelCatalog';

export interface LocalModelLabels {
  /** Heading above the downloadable catalog. */
  localCatalogHeading: string;
  /** The download action, e.g. "Download (1.2 GB)". */
  localDownload: string;
  /** Progress line while downloading. */
  localDownloading: string;
  localCancel: string;
  localRemove: string;
  /** Accessible name of a ready row's overflow (⋯) button. */
  localMoreActions: string;
  /** Badge on a model that may take a tool (agent) turn. */
  localTools: string;
  /** The context window, e.g. "32K context". */
  localContext: string;
  localDownloadFailed: string;
  localReasonWebgpu: string;
  localReasonF16: string;
  localReasonBuffer: string;
  localReasonVram: string;
  /** Runs without a GPU only on a device with more memory than this one has. */
  localReasonMemory: string;
  localReasonEngine: string;
  /** Badge on a `bfi` row saying where it runs here: on the GPU (WebGPU) or the CPU. */
  localBackendGpu: string;
  localBackendCpu: string;
  /** Section headings: what the curated models are for. */
  localGroupTools: string;
  localGroupChat: string;
  localGroupCoding: string;
  localGroupReasoning: string;
  localGroupMath: string;
  /** The expander over every other model, e.g. "All models (63)". */
  localAllModels: string;
  /** Collapses that expander again. */
  localFewerModels: string;
}

export const DEFAULT_LOCAL_MODEL_LABELS: LocalModelLabels = {
  localCatalogHeading: 'Download to run in this window',
  localDownload: 'Download ({size})',
  localDownloading: 'Downloading… {percent}%',
  localCancel: 'Cancel',
  localRemove: 'Remove',
  localMoreActions: 'More actions',
  localTools: 'Tools',
  localContext: '{tokens} context',
  localDownloadFailed: 'Download failed — try again.',
  localReasonWebgpu: 'Needs WebGPU, which this browser or GPU does not offer.',
  localReasonF16: 'Needs WebGPU 16-bit shaders, which this GPU does not offer.',
  localReasonBuffer: 'Needs larger GPU buffers than this device allows.',
  localReasonVram: 'Needs more GPU memory than this device has.',
  localReasonMemory: 'Needs more memory than this device has to run without a GPU.',
  localReasonEngine: 'This engine is not available here yet.',
  localBackendGpu: 'GPU',
  localBackendCpu: 'CPU',
  localGroupTools: 'Agents & tools',
  localGroupChat: 'Chat',
  localGroupCoding: 'Coding',
  localGroupReasoning: 'Reasoning',
  localGroupMath: 'Math',
  localAllModels: 'All models ({count})',
  localFewerModels: 'Fewer models',
};

/** Every field of {@link LocalModelLabels} — the ONE key table hosts read their catalog by. */
export const LOCAL_MODEL_LABEL_FIELDS = Object.keys(DEFAULT_LOCAL_MODEL_LABELS) as ReadonlyArray<keyof LocalModelLabels>;

/** A host's string for one label field, or undefined when its catalog has none. */
export type LocalModelLabelLookup = (field: keyof LocalModelLabels) => string | undefined;

/**
 * The on-device list's copy from a host catalog. Each host used to hand-map the same
 * fields onto its own keys (next-intl, `vscode.l10n`, `chrome.i18n`); a host now
 * passes a lookup by field and every label it lacks falls back to the English default.
 * Placeholders (`{size}`, `{percent}`, `{tokens}`) must come back literal.
 */
export function localModelLabelsFrom(lookup: LocalModelLabelLookup): LocalModelLabels {
  return stringsFrom(DEFAULT_LOCAL_MODEL_LABELS, (key) => lookup(key as keyof LocalModelLabels));
}

/** Why a row is unsupported → the label that says so. A registry, so a new fit code
 *  is one entry here rather than a branch in the row. */
export const LOCAL_UNSUPPORTED_LABEL: Record<NonNullable<LocalModelRow['reason']>, keyof LocalModelLabels> = {
  webgpu_unavailable: 'localReasonWebgpu',
  shader_f16_unavailable: 'localReasonF16',
  buffer_too_small: 'localReasonBuffer',
  vram_too_small: 'localReasonVram',
  memory_insufficient: 'localReasonMemory',
  engine_unavailable: 'localReasonEngine',
};

/** Where a row runs → its badge. A registry, so a new backend is one entry here. */
export const LOCAL_BACKEND_LABEL: Record<NonNullable<LocalModelRow['backend']>, keyof LocalModelLabels> = {
  webgpu: 'localBackendGpu',
  cpu: 'localBackendCpu',
};

/** A picker section → its heading. A registry, so a new section is one entry here. */
export const LOCAL_PICKER_GROUP_LABEL: Record<LocalPickerGroup, keyof LocalModelLabels> = {
  tools: 'localGroupTools',
  chat: 'localGroupChat',
  coding: 'localGroupCoding',
  reasoning: 'localGroupReasoning',
  math: 'localGroupMath',
};
