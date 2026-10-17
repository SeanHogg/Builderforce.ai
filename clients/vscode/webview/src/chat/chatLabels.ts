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

import {
  MODALITY_PERSONAS,
  PERSONA_MODALITY_IDS,
  type PersonaModalityId,
} from '@seanhogg/builderforce-brain-embedded';
import {
  DEFAULT_PROMPT_OPTIONS_LABELS,
  localModelLabelsFrom,
  timelineLabelsFrom,
  type BrainTimelineLabels,
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
 * `tl.liveAria`; every other path is `tl.<path>`. A key the bundle lacks falls back to the
 * package's English default.
 */
function timelineCatalogFromBundle(labels: LabelBundle): TimelineCatalogLookup {
  const bundleKey = (path: string): string => {
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

/** The composer's "To" control (shared `RecipientPicker`) copy. */
export function recipientPickerLabels(labels: LabelBundle): RecipientPickerLabels {
  const t = makeT(labels);
  return {
    to: t('app.to', 'To'),
    title: t('app.recipientPickerTitle', 'Send to'),
    brain: t('app.brainRecipient', 'BuilderForce'),
    brainHint: t('app.brainRecipientHint', 'Runs it'),
    agentHint: t('app.agentRecipientHint', 'Replies & acts'),
    humanHint: t('app.humanRecipientHint', 'Notified'),
  };
}

/** The composer's "Acting as" control (shared `PersonaPicker`) copy. */
export function personaPickerLabels(labels: LabelBundle): PersonaPickerLabels {
  const t = makeT(labels);
  return {
    actingAs: t('app.actingAs', 'Acting as'),
    title: t('app.personaTitle', 'Brain agent or persona'),
    defaultBrain: t('app.defaultBrain', 'Default Brain'),
    personas: t('app.personas', 'Personas'),
    assignedAgents: t('app.assignedAgents', 'Assigned agents'),
  };
}

/** English fallbacks for the modality persona names (localized via the host bundle). */
const MODALITY_LABEL_FALLBACK: Record<PersonaModalityId, string> = {
  designer: 'Website',
  mobile: 'Mobile',
  webmobile: 'Web + Mobile',
  evermind: 'Evermind',
  finetune: 'Fine-tune',
  voice: 'Voice',
};

/** The modality personas "Acting as" offers — the shared catalog, named in the editor's language. */
export function personaModalityOptions(labels: LabelBundle): PersonaModalityOption[] {
  const t = makeT(labels);
  return PERSONA_MODALITY_IDS.map((id) => ({
    id,
    label: t(`app.persona.modality.${id}`, MODALITY_LABEL_FALLBACK[id]),
    icon: MODALITY_PERSONAS[id].icon,
  }));
}

/**
 * The `/` menu's copy: its own chrome from the host's label bundle, and the model
 * rows' copy from `init.modelLabels` — the SAME object the host's `Change model`
 * QuickPick renders from, so the two pickers cannot describe a row differently.
 * The menu itself is the shared control (`PromptOptionsMenu`), identical to the
 * web composer's.
 */
export function promptMenuLabels(
  t: (key: string, fallback: string) => string,
  modelLabels: ModelChoiceLabels | undefined,
): PromptOptionsLabels {
  return {
    ...DEFAULT_PROMPT_OPTIONS_LABELS,
    ...(modelLabels ?? {}),
    options: t('app.options', 'Options'),
    mode: t('app.mode', 'Mode'),
    effort: t('app.effort', 'Effort'),
    effortQuick: t('app.effortQuick', 'Quick'),
    effortBalanced: t('app.effortBalanced', 'Balanced'),
    effortThorough: t('app.effortThorough', 'Thorough'),
    thinking: t('app.thinking', 'Thinking'),
    on: t('app.on', 'On'),
    off: t('app.off', 'Off'),
    memory: t('app.memory', 'Memory'),
    conversation: t('app.conversation', 'Conversation'),
    consolidate: t('app.consolidate', 'Consolidate'),
    consolidating: t('app.consolidating', 'Consolidating…'),
    consolidateHint: t('app.consolidateHint', 'Summarize this chat into a compact context the rest of the conversation builds on'),
    fork: t('app.fork', 'Fork'),
    forking: t('app.forking', 'Forking…'),
    forkHint: t('app.forkHint', 'Summarize this chat and continue in a new one from that summary'),
    sessionUnavailable: t('app.sessionUnavailable', 'Available once this chat has a few messages and no run in flight'),
    model: t('app.model', 'Model'),
    modelInUse: t('app.modelInUse', 'Model in use'),
    searchModels: t('app.searchModels', 'Search models…'),
    filterModels: t('app.filterModels', 'Filter models'),
    chooseModel: t('app.pickModel', 'Change model'),
    noModels: t('app.noModels', 'No matching models'),
    all: t('app.all', 'All'),
    modelLocked: t('app.modelLocked', 'Model choice needs a paid plan or a connected provider account.'),
    accountSettings: t('app.accountSettings', 'Account settings'),
    status: t('app.status', 'Status'),
    // The on-device list — the page engines this webview runs on WebGPU, from the host
    // bundle's `app.<field>` keys (`src/localModelLabels.ts`) through brain-ui's ONE key
    // table, which supplies the English for a key the bundle lacks (an empty fallback
    // reads as "none"); placeholders are filled per row by the shared list.
    ...localModelLabelsFrom((field) => t(`app.${field}`, '')),
  };
}
