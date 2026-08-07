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
 */

/** What the user picked. `auto` lets the gateway route; `byo_pool` walks the
 *  tenant's connected accounts in their configured priority order; `model` is a
 *  strict pin. */
export type ChatModelSelection =
  | { mode: 'auto' }
  | { mode: 'byo_pool' }
  | { mode: 'model'; model: string };

/** The selectable model surface, grouped by WHO PAYS (see {@link ModelCategory}). */
export interface ChatModelOptions {
  /** Tenant-defined named LLM configs (`tenant_model:<slug>`). */
  configured?: Array<{ id: string; label: string }>;
  /** Models the tenant's own connected provider accounts can serve. */
  byo: Array<{ id: string; vendor: string; cost?: string }>;
  free: Array<string | { id: string; cost?: string }>;
  plan: Array<string | { id: string; cost?: string }>;
  paid: Array<string | { id: string; cost?: string }>;
}

/** Funding tier of a model row — the axis the list is grouped and filtered by. */
export type ModelCategory = 'auto' | 'byo' | 'free' | 'plan' | 'paid' | 'configured';

/** One row in the model list. `detail` is the funding sentence for that row. */
export interface ModelItem {
  key: string;
  label: string;
  detail: string;
  category: ModelCategory;
  selection: ChatModelSelection;
}

/**
 * Every user-facing string in the menu. Hosts pass their own localized bundle
 * (the web app via next-intl, the VS Code webview via the host's `vscode.l10n`
 * bundle); the English defaults below keep the component usable unmapped.
 */
export interface PromptOptionsLabels {
  /** Trigger title/aria — the menu as a whole. */
  options: string;
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
  categoryAuto: string;
  categoryByo: string;
  categoryFree: string;
  categoryPlan: string;
  categoryPaid: string;
  categoryConfigured: string;
  autoLabel: string;
  autoDetail: string;
  poolLabel: string;
  poolDetail: string;
  freeDetail: string;
  planDetail: string;
  paidDetail: string;
  /** Per-model premium price line. `{input}` / `{output}` are the formatted
   *  per-1M-token rates (see `premiumCostLabel`). */
  paidCostDetail: string;
  /** `{vendor}` is substituted with the connected provider's name. */
  byoDetail: string;
  configuredDetail: string;
  /** Display name for a `project_evermind:<id>` pin (the raw pin is not a model name). */
  evermindLabel: string;
  /** Funding line for a `project_evermind:<id>` pin (a plan feature, not a catalog model). */
  evermindDetail: string;
  /** Shown instead of the list when the tenant may not pin a model at all. */
  modelLocked: string;
  accountSettings: string;
}

export const DEFAULT_PROMPT_OPTIONS_LABELS: PromptOptionsLabels = {
  options: 'Options',
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
  categoryAuto: 'Auto',
  categoryByo: 'BYO',
  categoryFree: 'Free',
  categoryPlan: 'Plan',
  categoryPaid: 'Paid',
  categoryConfigured: 'Configured',
  autoLabel: 'Auto',
  autoDetail: 'Routed per turn — your connected accounts first, then your plan.',
  poolLabel: 'BYO pool',
  poolDetail: 'Tries your connected accounts in the order configured in Account settings.',
  freeDetail: 'Free · included with BuilderForce',
  planDetail: 'Included with your BuilderForce plan',
  paidDetail: 'Premium — metered at cost + 1¢ per request',
  paidCostDetail: '{input} input / {output} output per 1M tokens + $0.01 per request',
  byoDetail: 'Billed to your own {vendor} account — no plan credit used.',
  configuredDetail: 'Saved workspace LLM configuration',
  evermindLabel: 'Project Evermind',
  evermindDetail: "Your project's own learned Evermind model.",
  modelLocked: 'Model choice needs a paid plan or a connected provider account.',
  accountSettings: 'Account settings',
};

/** Merge a host's partial overrides over the English defaults. */
export function promptOptionsLabels(overrides?: Partial<PromptOptionsLabels>): PromptOptionsLabels {
  return overrides ? { ...DEFAULT_PROMPT_OPTIONS_LABELS, ...overrides } : DEFAULT_PROMPT_OPTIONS_LABELS;
}
