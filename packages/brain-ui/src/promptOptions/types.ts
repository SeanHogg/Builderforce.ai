/**
 * The contract for the composer's `/` control — the ONE place a prompt panel
 * exposes run shaping (effort, thinking), WHICH MODEL IS IN USE, and how to
 * change it.
 *
 * Model choice used to live in a second control beside the `/` menu (a labelled
 * chip on the web, a chip that punted to a VS Code QuickPick in the editor), so
 * the composer had two different affordances for "what runs this turn" and the
 * editor's list could not even be read without leaving the panel. One control,
 * one contract, both hosts.
 *
 * The MODEL half of that contract (which models exist, their order, and who pays
 * for each) lives in brain-embedded's `modelChoice` — the VS Code extension HOST
 * shares it too, and it cannot import React.
 */
import { DEFAULT_MODEL_CHOICE_LABELS, type ModelChoiceLabels } from '@seanhogg/builderforce-brain-embedded';

export type {
  ChatModelOptions,
  ChatModelSelection,
  ModelCategory,
  ModelChoiceLabels,
  ModelItem,
} from '@seanhogg/builderforce-brain-embedded';

/**
 * Every user-facing string in the menu. Hosts pass their own localized bundle
 * (the web app via next-intl, the VS Code webview via the host's `vscode.l10n`
 * bundle); the English defaults below keep the component usable unmapped.
 */
export interface PromptOptionsLabels extends ModelChoiceLabels {
  /** Trigger title/aria — the menu as a whole. */
  options: string;
  /** Section heading for the conversation-mode block (Chat | Work). */
  mode: string;
  /** Section heading + row label for persistent project memory. */
  memory: string;
  /** Auto-approve canvas/tool actions for the next turn. */
  autoMode: string;
  /** Explains that Auto mode executes actions without a confirmation step. */
  autoModeHint: string;
  /** Section heading for the actions that act on the CHAT itself (consolidate, fork). */
  conversation: string;
  consolidate: string;
  consolidating: string;
  /** What consolidating actually does to the rest of the conversation. */
  consolidateHint: string;
  fork: string;
  forking: string;
  forkHint: string;
  /** Why neither conversation action can run yet (too short a chat, or a live run). */
  sessionUnavailable: string;
  effort: string;
  effortQuick: string;
  effortBalanced: string;
  effortThorough: string;
  thinking: string;
  on: string;
  off: string;
  /** Section heading for the model block. */
  model: string;
  /** Heading of the read-only "what is running this turn" row. */
  modelInUse: string;
  searchModels: string;
  filterModels: string;
  chooseModel: string;
  noModels: string;
  all: string;
  /** Shown instead of the list when the tenant may not pin a model at all. */
  modelLocked: string;
  accountSettings: string;
}

export const DEFAULT_PROMPT_OPTIONS_LABELS: PromptOptionsLabels = {
  ...DEFAULT_MODEL_CHOICE_LABELS,
  options: 'Options',
  mode: 'Mode',
  memory: 'Memory',
  autoMode: 'Auto mode',
  autoModeHint: 'Auto-approve actions without asking',
  conversation: 'Conversation',
  consolidate: 'Consolidate',
  consolidating: 'Consolidating…',
  consolidateHint: 'Summarize this chat into a compact context the rest of the conversation builds on',
  fork: 'Fork',
  forking: 'Forking…',
  forkHint: 'Summarize this chat and continue in a new one from that summary',
  sessionUnavailable: 'Available once this chat has a few messages and no run in flight',
  effort: 'Effort',
  effortQuick: 'Quick',
  effortBalanced: 'Balanced',
  effortThorough: 'Thorough',
  thinking: 'Thinking',
  on: 'On',
  off: 'Off',
  model: 'Model',
  modelInUse: 'Model in use',
  searchModels: 'Search models…',
  filterModels: 'Filter models',
  chooseModel: 'Choose model',
  noModels: 'No matching models',
  all: 'All',
  modelLocked: 'Model choice needs a paid plan or a connected provider account.',
  accountSettings: 'Account settings',
};

/** Merge a host's partial overrides over the English defaults. */
export function promptOptionsLabels(overrides?: Partial<PromptOptionsLabels>): PromptOptionsLabels {
  return overrides ? { ...DEFAULT_PROMPT_OPTIONS_LABELS, ...overrides } : DEFAULT_PROMPT_OPTIONS_LABELS;
}
