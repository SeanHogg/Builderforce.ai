/**
 * The editor chat's LOCALIZED COPY — everything that turns the host's label bundle
 * into strings a shared component can read.
 *
 * The host translates through `vscode.l10n`, so the strings live in the extension's
 * catalog and arrive as a flat `LabelBundle`. Shared components
 * (`<BrainTimeline>`, `<PromptOptionsMenu>`) want their own typed label shapes, and
 * building those was ~130 lines sitting at the top of the chat surface's own file,
 * where the transcript's state had to be scrolled past to reach them.
 *
 * They are pure functions of the bundle, so they belong out here where they can be
 * memoized by their one input and read without the surface around them.
 */

import { MODALITY_PERSONAS, PERSONA_MODALITY_IDS } from '@seanhogg/builderforce-brain-embedded';
import {
  DEFAULT_ASK_USER_LABELS,
  DEFAULT_CHAT_ERROR_LABELS,
  DEFAULT_PERSONA_PICKER_LABELS,
  DEFAULT_QUEUED_TURN_LABELS,
  DEFAULT_RECIPIENT_PICKER_LABELS,
  DEFAULT_SURFACE_HEADER_LABELS,
  bundleLookup,
  chatHistoryLabelsFrom,
  prefetchChipLabelsFrom,
  promptOptionsLabelsFrom,
  stringsFrom,
  timelineLabelsFrom,
  toolConfirmLabelsFrom,
  type AskUserLabels,
  type BrainTimelineLabels,
  type ChatErrorBannerLabels,
  type ChatHistoryLabels,
  type QueuedTurnChipsLabels,
  type SurfaceHeaderLabels,
  type ToolConfirmBarLabels,
  type PrefetchChipLabels,
  type PrefetchLabelOf,
  type TimelineCatalogLookup,
  type ModelChoiceLabels,
  type PersonaModalityOption,
  type PersonaPickerLabels,
  type PromptOptionsLabels,
  type RecipientPickerLabels,
} from '@seanhogg/builderforce-brain-ui';
import type { LabelBundle } from '../vscodeBridge';

/** Read a localized string from the host's bundle, falling back to English. */
export function makeT(labels: LabelBundle) {
  return (key: string, fallback: string): string => labels[key] ?? fallback;
}

/**
 * The host bundle's `tl.*` keys, addressed by the CANONICAL transcript key paths that
 * brain-ui's one catalog → label table (`timelineLabelsFrom`) reads — `live.starting` is
 * `tl.liveStarting`, the live `thinking` line shares `tl.thinking`, `live.ariaLabel` is
 * `tl.liveAria`; the error step row's `chatError.<field>` is the banner's own `app.<field>`
 * (one string for both); every other path is `tl.<path>`. A key the bundle lacks falls
 * back to the package's English default.
 */
function timelineCatalogFromBundle(labels: LabelBundle): TimelineCatalogLookup {
  const bundleKey = (path: string): string => {
    if (path.startsWith('chatError.')) return `app.${path.slice('chatError.'.length)}`;
    if (!path.startsWith('live.')) return `tl.${path}`;
    const field = path.slice('live.'.length);
    if (field === 'thinking') return 'tl.thinking';
    if (field === 'ariaLabel') return 'tl.liveAria';
    return `tl.live${field.charAt(0).toUpperCase()}${field.slice(1)}`;
  };
  return (path) => labels[bundleKey(path)] || undefined;
}

/** The shared <BrainTimeline>'s copy, from the host bundle through the shared table. */
export function timelineLabels(labels: LabelBundle): BrainTimelineLabels {
  return timelineLabelsFrom(timelineCatalogFromBundle(labels));
}

/** The pickers' fields → the bundle's keys (the English is brain-ui's defaults). */
const RECIPIENT_KEY: Readonly<Record<string, string>> = {
  to: 'app.to',
  title: 'app.recipientPickerTitle',
  brain: 'app.brainRecipient',
  brainHint: 'app.brainRecipientHint',
  agentHint: 'app.agentRecipientHint',
  humanHint: 'app.humanRecipientHint',
};
const PERSONA_KEY: Readonly<Record<string, string>> = {
  actingAs: 'app.actingAs',
  title: 'app.personaTitle',
  defaultBrain: 'app.defaultBrain',
  personas: 'app.personas',
  assignedAgents: 'app.assignedAgents',
};

/** The composer's "To" control (shared `RecipientPicker`) copy. */
export function recipientPickerLabels(labels: LabelBundle): RecipientPickerLabels {
  return stringsFrom(DEFAULT_RECIPIENT_PICKER_LABELS, bundleLookup(labels, (k) => RECIPIENT_KEY[k]));
}

/** The composer's "Acting as" control (shared `PersonaPicker`) copy. */
export function personaPickerLabels(labels: LabelBundle): PersonaPickerLabels {
  return stringsFrom(DEFAULT_PERSONA_PICKER_LABELS, bundleLookup(labels, (k) => PERSONA_KEY[k]));
}

/** The shared header's levers, the history rows and the run-confirm bar → the bundle's keys. */
const HEADER_KEY: Readonly<Record<string, string>> = {
  newChat: 'app.newChat',
  historyShow: 'app.historyShow',
  historyHide: 'app.historyHide',
};
const CHAT_HISTORY_KEY: Readonly<Record<string, string>> = {
  loading: 'app.historyLoading',
  empty: 'app.historyEmpty',
  actions: 'app.chatActions',
  actionsAria: 'app.chatActionsAria',
  rename: 'app.rename',
  summarize: 'app.chatSummarize',
  delete: 'app.chatDelete',
  archive: 'app.chatArchive',
};
const TOOL_CONFIRM_KEY: Readonly<Record<string, string>> = {
  prompt: 'app.confirmRun',
  approve: 'app.approve',
  approveAll: 'app.always',
  deny: 'app.cancel',
  aria: 'app.confirmAria',
};

const ASK_USER_KEY: Readonly<Record<string, string>> = {
  askSubmit: 'tl.askSubmit',
  askAnswered: 'tl.askAnswered',
  askPending: 'app.askPending',
  askJumpTo: 'app.askJumpTo',
  askDismiss: 'app.dismiss',
};
const QUEUED_TURN_KEY: Readonly<Record<string, string>> = {
  list: 'app.queuedLabel',
  hint: 'app.queuedHint',
  steer: 'app.steerNow',
  steerHint: 'app.steerNowHint',
  remove: 'app.remove',
};

/** The shared `ChatErrorBanner` (remedy buttons + dismiss): every field is `app.<field>`. */
export function chatErrorLabels(labels: LabelBundle): ChatErrorBannerLabels {
  return stringsFrom(DEFAULT_CHAT_ERROR_LABELS, bundleLookup(labels, (k) => `app.${k}`));
}

/** The shared ask-user copy (the question card's submit, the pending-question banner). */
export function askUserLabels(labels: LabelBundle): AskUserLabels {
  return stringsFrom(DEFAULT_ASK_USER_LABELS, bundleLookup(labels, (k) => ASK_USER_KEY[k]));
}

/** The shared queued-turn chips above the composer. */
export function queuedTurnLabels(labels: LabelBundle): QueuedTurnChipsLabels {
  return stringsFrom(DEFAULT_QUEUED_TURN_LABELS, bundleLookup(labels, (k) => QUEUED_TURN_KEY[k]));
}

/** The chat surface's `SurfaceHeader` levers (New chat, History). */
export function surfaceHeaderLabels(labels: LabelBundle): SurfaceHeaderLabels {
  return stringsFrom(DEFAULT_SURFACE_HEADER_LABELS, bundleLookup(labels, (k) => HEADER_KEY[k]));
}

/** The shared chat-history list and rows. */
export function chatHistoryLabels(labels: LabelBundle): ChatHistoryLabels {
  return chatHistoryLabelsFrom(bundleLookup(labels, (k) => CHAT_HISTORY_KEY[k]));
}

/** The PreFetch chips' copy (`prefetch.chip.<field>`, `src/prefetch/prefetchLabels.ts`). */
export function prefetchChipLabels(labels: LabelBundle): PrefetchChipLabels {
  return prefetchChipLabelsFrom(bundleLookup(labels, (k) => `prefetch.chip.${k}`));
}

/** An action's or chip's name (`prefetch.action.<id>`, `prefetch.chip.<x>`) from the bundle. */
export function prefetchLabelOf(labels: LabelBundle): PrefetchLabelOf {
  return (key) => labels[key];
}

/** The shared run-confirm bar (the chat's own run and each sub-agent's). */
export function toolConfirmLabels(labels: LabelBundle): ToolConfirmBarLabels {
  return toolConfirmLabelsFrom(bundleLookup(labels, (k) => TOOL_CONFIRM_KEY[k]));
}

/**
 * The modality personas "Acting as" offers — the shared catalog, named in the editor's
 * language (`app.persona.modality.<id>`) over the persona's own English name.
 */
export function personaModalityOptions(labels: LabelBundle): PersonaModalityOption[] {
  return PERSONA_MODALITY_IDS.map((id) => ({
    id,
    label: labels[`app.persona.modality.${id}`] || MODALITY_PERSONAS[id].label,
    icon: MODALITY_PERSONAS[id].icon,
  }));
}

/**
 * Where a `/` menu field lives in the host bundle: `app.<field>` (the on-device list's
 * fields included, `src/localModelLabels.ts`), except `chooseModel` (`app.pickModel`).
 * The bundle's `app.autoModeHint` is the COMPOSER's sentence, so the menu's own field
 * is left to brain-ui's default.
 */
export function optionBundleKey(field: string): string | undefined {
  if (field === 'autoModeHint') return undefined;
  return field === 'chooseModel' ? 'app.pickModel' : `app.${field}`;
}

/**
 * The `/` menu's copy: its own chrome from the host's label bundle, and the model
 * rows' copy from `init.modelLabels` — the SAME object the host's `Change model`
 * QuickPick renders from, so the two pickers cannot describe a row differently.
 * The key table and English are brain-ui's (`promptOptionsLabelsFrom`).
 */
export function promptMenuLabels(
  t: (key: string, fallback: string) => string,
  modelLabels: ModelChoiceLabels | undefined,
): PromptOptionsLabels {
  const rows = (modelLabels ?? {}) as Partial<Record<string, string>>;
  return promptOptionsLabelsFrom((field) => {
    const key = optionBundleKey(field);
    return (key ? t(key, '') : '') || rows[field];
  });
}
