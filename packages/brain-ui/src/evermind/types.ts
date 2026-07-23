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
  /** Stable unique id — targets a specific learned memory (Validate highlight / detail). */
  id: number;
  /** 'text' = a run/exemplar adapted here; 'delta' = a pre-diffed weight delta. */
  kind: 'text' | 'delta';
  /** The version this contribution was merged into. */
  version: number;
  /** Epoch ms the merge landed. */
  at: number;
  /** FedAvg sample weight. */
  weight: number;
  /** The task prompt the run addressed (text-path only). */
  prompt?: string;
  /** The run/exemplar text that was learned (text-path only). Absent when a pinned
   *  teacher failed on a teach-a-task — see `skipReason`. */
  text?: string;
  /** True when a frontier teacher shaped what was learned (text-path only). */
  distilled?: boolean;
  /** The frontier model that distilled this entry (present when `distilled`). */
  teacherModel?: string;
  /** Why distillation did NOT happen — {@link EvermindTeacherSkipReason}. */
  skipReason?: string;
  /** Operator-facing detail behind `skipReason` (HTTP status, exception message). */
  skipDetail?: string;
  /** The pinned teacher model that failed (present on a distillation fault). */
  attemptedTeacherModel?: string;
}

/** A scored recall match — a learned memory plus its 0..1 relevance to a task. */
export interface EvermindValidateMatch extends EvermindRecentEntry {
  /** Lexical relevance of this memory to the validated task, 0..1. */
  score: number;
}

/** The Validate result: which learned memories would answer a candidate task. */
export interface EvermindValidateResult {
  prompt: string;
  version: number;
  seeded: boolean;
  /** Ranked best-first; empty when nothing learned matches the task. */
  matches: EvermindValidateMatch[];
  /** Id of the memory most likely used to respond, or null if none matched. */
  primaryId: number | null;
  /** Which ranker produced these matches: the model's own SSM embedding (semantic)
   *  or a lexical fallback when the model couldn't be reached. */
  method: 'embedding' | 'lexical';
}

/** The latest automatic pre/post regression check: the previous vs merged model scored
 *  on the same held-out set of prior taught examples. `delta = baseLoss - newLoss`. */
export interface EvermindEvalPoint {
  version: number;
  at: number;
  baseLoss: number;
  newLoss: number;
  /** positive = improved / retained on prior tasks; negative = regressed. */
  delta: number;
  evalSize: number;
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
  /** Latest automatic regression check (▲/▼ vs the previous version), or null. */
  eval?: EvermindEvalPoint | null;
  /**
   * True when this Evermind belongs to the project's PARENT container, not to the
   * project the console is scoped to.
   *
   * Only `evermind`-modality builds get their own `project_evermind` row; every other
   * modality (video, voice, designer, finetune) inherits its container's — deliberately,
   * so a build opens with the container's trained model instead of an empty one, and so
   * learning stays pooled across the group rather than sharded per build.
   *
   * The console MUST render read-only when this is set. Reads inherit, but every write
   * endpoint keeps exact-id semantics (a contribution must never silently land on the
   * wrong project), so a seed/toggle/teach issued from an inheriting build targets a row
   * that does not exist — it updates zero rows and returns OK. Offering those controls
   * here would be an affordance that does nothing.
   */
  inherited?: boolean;
  /** The container project whose Evermind is being displayed (present when `inherited`). */
  inheritedFromProjectId?: number;
  /**
   * ISO timestamp this Evermind auto-quarantined after a streak of incoherent serves
   * (null/absent = healthy). While quarantined it serves nothing and cannot be
   * re-enabled until it passes the coherence probe again — the console renders a badge
   * + reason so "why did it turn itself off / why can't I turn it on" is never a mystery.
   */
  quarantinedAt?: string | null;
  /** The probe-failure reason behind {@link quarantinedAt} (present when quarantined). */
  quarantineReason?: string | null;
}

/**
 * One Evermind a project targets — its own head, or the head of an IDE build grouped
 * under it. Shape mirrors the api `targetsCore` endpoint. Ordered `[self, …builds]`,
 * so index 0 is the project itself. Learning fans out to every live target; inference
 * stays single-pick. Read-only in the console.
 */
export interface EvermindTarget {
  projectId: number;
  version: number;
  name: string;
  mode: EvermindMode;
  inferenceEnabled: boolean;
  seeded: boolean;
}

/**
 * The outcome of importing a local builderforce-memory snapshot into this Evermind:
 * how many raw facts were absorbed + merged (and the resulting version), plus how many
 * source entries were then compacted to terse stubs and the bytes that recovered. A
 * host returns `null` from {@link EvermindConsoleAdapter.importMemory} when the user
 * cancels the file picker (a no-op, not an error).
 */
export interface MemoryImportReport {
  /** The file the user imported (basename), for the confirmation notice. */
  fileName: string;
  /** Raw facts accepted into the learn queue. */
  absorbed: number;
  /** Facts skipped (too short / rejected), with the reason count rolled up. */
  skipped: number;
  /** Contributions merged into the model by the closing flush. */
  merged: number;
  /** Model version after the merge — stamped into each compacted stub. */
  version: number;
  /** Source entries rewritten to `[absorbed→Evermind vN]` stubs. */
  compacted: number;
  /** Bytes removed from the snapshot by compaction (the context-bloat recovered). */
  bytesSaved: number;
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
  /** Validate a candidate task: which learned memories would answer it (ranked). */
  validate(prompt: string): Promise<EvermindValidateResult>;
  /**
   * OPTIONAL — import a local builderforce-memory snapshot into this Evermind and
   * compact the absorbed facts to stubs. Only hosts with local filesystem access (the
   * VS Code editor) implement it; the web app leaves it undefined, so the console hides
   * the Import control there. Resolves to a {@link MemoryImportReport}, or `null` when
   * the user cancels the file picker.
   */
  importMemory?(): Promise<MemoryImportReport | null>;
  /**
   * OPTIONAL — list every Evermind under this project (self + the IDE builds grouped
   * under it). When present, the console renders the read-only "Everminds under this
   * project" list; a host that omits it simply hides the section. Ordered `[self, …builds]`.
   */
  loadTargets?(): Promise<EvermindTarget[]>;
}

/** Every visible string. Parametric ones are functions the host localizes. */
export interface EvermindConsoleLabels {
  title: string;
  description: string;
  loading: string;
  managerOnlyHint: string;
  /** Shown instead of the training controls when this build INHERITS its container
   *  project's Evermind (see {@link EvermindConsoleData.inherited}) — it explains that
   *  the model is shared and that training happens on the parent project. */
  inheritedHint: string;
  // Status
  statusSeeded: (version: number) => string;
  statusUnseeded: string;
  // Quarantine (auto-disabled after incoherent serves)
  quarantinedBadge: string;
  quarantinedHint: (reason: string) => string;
  // Targets ("Everminds under this project")
  targetsTitle: string;
  targetsHint: string;
  targetsEmpty: string;
  targetSelfBadge: string;
  targetBuildBadge: string;
  targetSeeded: (version: number) => string;
  targetUnseeded: string;
  targetInferenceOn: string;
  targetConnected: string;
  targetFrozen: string;
  targetProjectId: (id: number) => string;
  // Regression check (▲/▼ vs previous version)
  evalDelta: (pct: string) => string;
  evalFlat: string;
  evalTooltip: (version: number, base: string, next: string, size: number) => string;
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
  /** Shown when a teacher IS pinned: explains teaching is now automatic. */
  teacherActiveHint: (model: string) => string;
  // Teach-from-text
  teachTitle: string;
  teachHint: string;
  teachPromptPlaceholder: string;
  teachTextPlaceholder: string;
  teachCta: string;
  teaching: string;
  taught: string;
  // Teach-a-task (shown instead of teach-from-transcript when a teacher is pinned)
  teachTeacherTitle: string;
  teachTeacherHint: (model: string) => string;
  teachTaskPlaceholder: string;
  teachTeacherCta: string;
  // Flush
  flushCta: string;
  flushing: string;
  flushedNone: string;
  flushedN: (merged: number, version: number) => string;
  // Import from builderforce-memory (VS Code only — host has filesystem access)
  importTitle: string;
  importHint: string;
  importCta: string;
  importing: string;
  /** Success: N facts absorbed into vX, M entries compacted to stubs, K bytes recovered. */
  importDone: (absorbed: number, version: number, compacted: number, savedKb: string) => string;
  /** The picked file had nothing learnable (all too short / already stubbed). */
  importNothing: string;
  // Validate (recall preview)
  validateCta: string;
  validating: string;
  validateHint: string;
  validateResultTitle: (prompt: string) => string;
  validateEmpty: string;
  validatePrimaryBadge: string;
  validateScore: (pct: number) => string;
  validateClear: string;
  /** Honest label for how the ranking was produced (semantic embedding vs lexical). */
  validateMethod: (method: 'embedding' | 'lexical') => string;
  // Inspection
  inspectTitle: string;
  inspectEmpty: string;
  kindText: string;
  kindDelta: string;
  deltaEntry: string;
  versionTag: (version: number) => string;
  weightTag: (weight: number) => string;
  viewDetail: string;
  hideDetail: string;
  detailPromptLabel: string;
  detailTextLabel: string;
  /** Badge on a row whose pinned teacher produced no exemplar. */
  notDistilled: string;
  /** Provenance note naming the frontier teacher that distilled the row. */
  distilledBy: (model: string) => string;
  /** The expanded explanation of a distillation fault (model may be empty). */
  teacherFault: (model: string, reason: string) => string;
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
  inheritedHint:
    'This build shares its parent project’s Evermind, so everything it has learned is available here. Training and settings live on the parent project.',
  statusSeeded: (v) => `Learning · v${v}`,
  statusUnseeded: 'Not set up',
  quarantinedBadge: 'Quarantined',
  quarantinedHint: (reason) =>
    `This Evermind auto-disabled after producing incoherent output (${reason}). Retrain it past the coherence bar to re-enable inference.`,
  targetsTitle: 'Everminds under this project',
  targetsHint: 'Every Evermind this project contributes learning to.',
  targetsEmpty: 'No Everminds resolved for this project yet.',
  targetSelfBadge: 'This project',
  targetBuildBadge: 'IDE build',
  targetSeeded: (version) => `v${version}`,
  targetUnseeded: 'not seeded',
  targetInferenceOn: 'inference',
  targetConnected: 'connected',
  targetFrozen: 'frozen',
  targetProjectId: (id) => `project #${id}`,
  evalDelta: (pct) => `${pct}% vs prev`,
  evalFlat: 'no change',
  evalTooltip: (version, base, next, size) => `Regression check on v${version}: held-out loss ${base} → ${next} across ${size} prior task(s).`,
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
  teacherHint: 'Distil learning through a frontier model (task → its ideal answer) instead of raw run text. Pick one to enable — then every agent run learns from its answer, and you can teach it a task directly below.',
  teacherNone: 'None (learn from raw runs)',
  teacherPaidOnly: 'A teacher model is available on paid plans.',
  teacherActiveHint: (m) => `Teaching from ${m}. Every agent run — and each task you teach below — is answered by ${m}, and your Evermind learns from its ideal answer. There is nothing else to switch on.`,
  teachTitle: 'Teach from a transcript',
  teachHint: 'Paste a chat transcript or exemplar to contribute it to the model now.',
  teachPromptPlaceholder: 'Task this answered (optional)…',
  teachTextPlaceholder: 'Paste the transcript or exemplar text…',
  teachCta: 'Teach',
  teaching: 'Teaching…',
  taught: 'Queued for learning.',
  teachTeacherTitle: 'Teach a task',
  teachTeacherHint: (m) => `Describe a task and ${m} answers it — your Evermind learns from the ideal answer. No transcript needed.`,
  teachTaskPlaceholder: 'Describe a task to teach — the teacher will answer it…',
  teachTeacherCta: 'Teach from teacher',
  flushCta: 'Learn now',
  flushing: 'Learning…',
  flushedNone: 'Nothing queued to learn yet.',
  flushedN: (merged, version) => `Merged ${merged} contribution(s) into v${version}.`,
  importTitle: 'Import from builderforce-memory',
  importHint: 'Fold a local memory snapshot into this model, then compact the absorbed facts to stubs so they stop filling your context.',
  importCta: 'Import & compact…',
  importing: 'Importing…',
  importDone: (absorbed, version, compacted, savedKb) => `Absorbed ${absorbed} memor${absorbed === 1 ? 'y' : 'ies'} into v${version}; compacted ${compacted} to stubs (~${savedKb} KB recovered).`,
  importNothing: 'Nothing to import — no learnable facts in that file.',
  validateCta: 'Validate',
  validating: 'Checking…',
  validateHint: 'Check which learned memories would answer this task — before you teach it.',
  validateResultTitle: (p) => `Memories that would answer “${p}”`,
  validateEmpty: 'No learned memory matches this task yet — teaching it would add new knowledge.',
  validatePrimaryBadge: 'Most likely used',
  validateScore: (pct) => `${pct}% match`,
  validateClear: 'Clear',
  validateMethod: (m) => (m === 'embedding' ? 'Semantic recall' : 'Lexical recall (fallback)'),
  inspectTitle: 'Recently learned',
  inspectEmpty: 'Nothing learned yet. Runs and teaching will appear here.',
  kindText: 'Run',
  kindDelta: 'Delta',
  deltaEntry: 'Weight delta contributed by an agent run.',
  versionTag: (v) => `v${v}`,
  weightTag: (w) => `×${w}`,
  viewDetail: 'View detail',
  hideDetail: 'Hide detail',
  detailPromptLabel: 'Task',
  detailTextLabel: 'Learned',
  notDistilled: 'Not distilled',
  distilledBy: (model) => `via ${model}`,
  teacherFault: (model, reason) =>
    `The teacher${model ? ` (${model})` : ''} produced no answer (${reason}), so nothing was learned for this task. ` +
    'Check the pinned teacher model and your frontier credit, then teach it again.',
  refresh: 'Refresh',
  errorGeneric: 'Something went wrong. Try again.',
};
