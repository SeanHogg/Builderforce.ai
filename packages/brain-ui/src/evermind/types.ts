/**
 * Shared types for the <EvermindConsole> — the per-project Evermind inspect-and-train
 * surface rendered identically on the web app and inside the VS Code sidebar webview.
 * The console is presentational + self-managing; each host injects an
 * {@link EvermindConsoleAdapter} (its own REST calls) and an {@link EvermindConsoleLabels}
 * bundle (its own i18n). See [[evermind-learning-architecture]].
 */

export type EvermindMode = 'connected' | 'offline-frozen';

/** One inspectable contribution the coordinator merged into a version. */
export interface EvermindRecentEntry {
  /** 'text' = a run/exemplar adapted here; 'delta' = a pre-diffed weight delta. */
  kind: 'text' | 'delta';
  /** The version this contribution was merged into. */
  version: number;
  /** Epoch ms the merge landed. */
  at: number;
  /** FedAvg sample weight. */
  weight: number;
  /** Readable snippet of the task prompt the run addressed (text-path only). */
  prompt?: string;
  /** Readable snippet of the run/exemplar text learned (text-path only). */
  text?: string;
}

/** The head summary + live learning activity for a project's Evermind. */
export interface EvermindConsoleData {
  version: number;
  seeded: boolean;
  mode: EvermindMode;
  contributions: number;
  inferenceEnabled: boolean;
  teacherModel: string | null;
  lastLearnedAt: string | null;
  /** Contributions queued but not yet merged (in the coordinator's debounce window). */
  pending: number;
  recent: EvermindRecentEntry[];
}

/** A published Studio Evermind model that can seed a project's learnable base. */
export interface EvermindSeedModel {
  slug: string;
  name: string;
}

/** The teacher picker's options: the plan's coding models + whether teachers are allowed. */
export interface EvermindTeacherOptions {
  models: string[];
  isPaid: boolean;
}

/**
 * Host-provided data access + mutations — the only coupling to a backend. The web
 * app wires this to its `projectEvermindApi` client; the VS Code webview wires it to
 * its bearer-fetch REST client. Same console, same endpoints, different host.
 */
export interface EvermindConsoleAdapter {
  /** Read the console payload (head summary + queued depth + recent-learned ring). */
  loadData(): Promise<EvermindConsoleData>;
  /** Publishable Evermind models for the unseeded seed picker (managers only). */
  loadSeedModels(): Promise<EvermindSeedModel[]>;
  /** The teacher picker's model list + plan gate (managers only). */
  loadTeacherOptions(): Promise<EvermindTeacherOptions>;
  seedFromModel(slug: string): Promise<void>;
  setInference(enabled: boolean): Promise<void>;
  setMode(mode: EvermindMode): Promise<void>;
  setTeacher(model: string | null): Promise<void>;
  /** Teach from raw text (a transcript / exemplar); `prompt` is the task it answered. */
  teach(text: string, prompt?: string): Promise<void>;
  /** Force a merge now; returns how many merged + the resulting version. */
  flush(): Promise<{ merged: number; version: number }>;
}

/** Every visible string. Parametric ones are functions the host localizes. */
export interface EvermindConsoleLabels {
  title: string;
  description: string;
  loading: string;
  managerOnlyHint: string;
  // Status
  statusSeeded: (version: number) => string;
  statusUnseeded: string;
  // Seed (unseeded state)
  pickModelLabel: string;
  noModels: string;
  notSetUp: string;
  enableCta: string;
  working: string;
  // Stats
  versionLabel: string;
  contributionsLabel: string;
  pendingLabel: string;
  lastLearnedLabel: string;
  neverLearned: string;
  formatWhen: (atMs: number) => string;
  // Toggles
  inferenceLabel: string;
  inferenceHint: string;
  learningLabel: string;
  learningHint: string;
  on: string;
  off: string;
  connected: string;
  frozen: string;
  // Teacher
  teacherLabel: string;
  teacherHint: string;
  teacherNone: string;
  teacherPaidOnly: string;
  // Teach-from-text
  teachTitle: string;
  teachHint: string;
  teachPromptPlaceholder: string;
  teachTextPlaceholder: string;
  teachCta: string;
  teaching: string;
  taught: string;
  // Flush
  flushCta: string;
  flushing: string;
  flushedNone: string;
  flushedN: (merged: number, version: number) => string;
  // Inspection
  inspectTitle: string;
  inspectEmpty: string;
  kindText: string;
  kindDelta: string;
  deltaEntry: string;
  versionTag: (version: number) => string;
  weightTag: (weight: number) => string;
  // Misc
  refresh: string;
  errorGeneric: string;
}

/** A tiny English relative-time default (host overrides with its own i18n formatter). */
function defaultFormatWhen(atMs: number): string {
  const diff = atMs - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (abs < min) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < hr) return rtf.format(Math.round(diff / min), 'minute');
  if (abs < day) return rtf.format(Math.round(diff / hr), 'hour');
  return rtf.format(Math.round(diff / day), 'day');
}

/** English defaults — the VS Code webview seeds these; the web app overrides via next-intl. */
export const DEFAULT_EVERMIND_LABELS: EvermindConsoleLabels = {
  title: 'Project Evermind',
  description:
    'The self-learning model for this project. It adapts as this project’s agents run — inspect what it has learned and steer its training below.',
  loading: 'Loading…',
  managerOnlyHint: 'Only a project manager can change these settings.',
  statusSeeded: (v) => `Learning · v${v}`,
  statusUnseeded: 'Not set up',
  pickModelLabel: 'Base model',
  noModels: 'No published Evermind models to start from yet. Train and publish one in Studio first.',
  notSetUp: 'This project’s Evermind hasn’t been set up yet. A project manager can enable it.',
  enableCta: 'Enable',
  working: 'Working…',
  versionLabel: 'Version',
  contributionsLabel: 'Learned',
  pendingLabel: 'Queued',
  lastLearnedLabel: 'Last learned',
  neverLearned: 'Never',
  formatWhen: defaultFormatWhen,
  inferenceLabel: 'Run on Evermind',
  inferenceHint: 'When on, this project’s agent runs execute on its own learned model.',
  learningLabel: 'Learning',
  learningHint: 'When connected, runs contribute what they learn back into the model.',
  on: 'On',
  off: 'Off',
  connected: 'Connected',
  frozen: 'Frozen',
  teacherLabel: 'Teacher model',
  teacherHint: 'Distil each run through a frontier model (task → ideal answer) instead of raw run text.',
  teacherNone: 'None (learn from raw runs)',
  teacherPaidOnly: 'A teacher model is available on paid plans.',
  teachTitle: 'Teach from a transcript',
  teachHint: 'Paste a chat transcript or exemplar to contribute it to the model now.',
  teachPromptPlaceholder: 'Task this answered (optional)…',
  teachTextPlaceholder: 'Paste the transcript or exemplar text…',
  teachCta: 'Teach',
  teaching: 'Teaching…',
  taught: 'Queued for learning.',
  flushCta: 'Learn now',
  flushing: 'Learning…',
  flushedNone: 'Nothing queued to learn yet.',
  flushedN: (merged, version) => `Merged ${merged} contribution(s) into v${version}.`,
  inspectTitle: 'Recently learned',
  inspectEmpty: 'Nothing learned yet. Runs and teaching will appear here.',
  kindText: 'Run',
  kindDelta: 'Delta',
  deltaEntry: 'Weight delta contributed by an agent run.',
  versionTag: (v) => `v${v}`,
  weightTag: (w) => `×${w}`,
  refresh: 'Refresh',
  errorGeneric: 'Something went wrong. Try again.',
};
