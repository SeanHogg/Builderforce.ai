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

/** What a teach POST can tell the caller: the id its contribution was queued under.
 *  Absent on a host (or server) that predates the pollable status channel. */
export interface EvermindTeachResult {
  contributionId?: number;
}

/**
 * How one enqueued contribution ended up. `pending` is transient; every other state is
 * terminal, so a poller has a defined stopping condition.
 *
 * `merged` means it is IN THE WEIGHTS — including when a pinned teacher faulted, since
 * the contribution still learns un-distilled. `dropped` means a merge consumed it and it
 * never became a memory (stale base, no trainable window, non-LM head). `unknown` is the
 * server declining to answer (no coordinator binding, or an unreadable reply).
 */
export type EvermindContributionState = 'pending' | 'merged' | 'dropped' | 'unknown';

/**
 * One contribution's status. The provenance fields are the RING'S, deliberately —
 * {@link EvermindContributionStatus} is graded by the same `evermindLearnedStatus` that
 * grades a Learnings row, so a teach's reported outcome and that memory's own row can
 * never tell the operator two different stories.
 */
export interface EvermindContributionStatus {
  contributionId: number;
  state: EvermindContributionState;
  kind?: 'text' | 'delta';
  /** The version it merged INTO (present only when `merged`). */
  version?: number;
  distilled?: boolean;
  teacherModel?: string;
  /** {@link EvermindTeacherSkipReason} — why a teacher did not shape this. */
  skipReason?: string;
  skipDetail?: string;
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
 * One graded generation from the TEST BENCH — what the model actually produced for a
 * prompt, plus the verdict the SERVE PATH would reach on it. This is the difference
 * between "which memories would be recalled" (Validate) and "what will a user see"
 * (this): only the latter can catch a head that emits gibberish, before a user does.
 */
export interface EvermindProbeSample {
  prompt: string;
  /** The raw text the model generated. Shown verbatim — no cleanup, no truncation. */
  text: string;
  /** Whether this output would be served to a user, or refused as unusable. */
  coherent: boolean;
  /** Which signal rejected it (`repetition`, `non-words`, …); null when it passed. */
  failure: string | null;
  /** Plain-language explanation of {@link failure} (empty when coherent). */
  detail: string;
}

/** A test-bench run: one prompt, or the fixed readiness suite the enable-gate uses. */
export interface EvermindProbeResult {
  version: number;
  /** `readiness` = the fixed probe suite that gates enabling inference; `prompt` = the
   *  operator's own prompt. Both are graded identically. */
  mode: 'readiness' | 'prompt';
  /** Whether the run clears the bar (a readiness run needs a MAJORITY of samples). */
  ready: boolean;
  /** Fraction of samples that were servable (0..1). */
  passRate: number;
  samples: EvermindProbeSample[];
}

/** What a knowledge audit concluded about one learned memory. */
export type EvermindKnowledgeVerdict = 'ok' | 'incoherent' | 'incorrect' | 'outdated' | 'unusable' | 'redundant';

/** One audited memory: what is wrong with it and (when repairable) the replacement. */
export interface EvermindKnowledgeFinding {
  id: number;
  verdict: EvermindKnowledgeVerdict;
  /** One sentence naming the problem. */
  issue: string;
  /** The task this memory answered — the key its correction is re-taught under. */
  prompt?: string;
  /** Excerpt of the memory as it stands today. */
  excerpt: string;
  /** The corrected knowledge to learn instead. Absent when the memory is simply dropped. */
  correction?: string;
  /** Whether the local coherence screen or the frontier reviewer produced this verdict. */
  source: 'coherence-gate' | 'frontier';
}

/** The result of a read-only knowledge audit. */
export interface EvermindKnowledgeAnalysis {
  version: number;
  /** How many learned memories were reviewed. */
  analyzed: number;
  /** The frontier model that graded, or null when only the local screen ran. */
  model: string | null;
  findings: EvermindKnowledgeFinding[];
  /** How many memories the model holds in total. Differs from `analyzed` once the
   *  project has learned more than one pass reviews. Absent from an older API. */
  total?: number;
  /** True when there is more history than this pass looked at — the summary says so
   *  rather than implying the whole model was audited. */
  truncated?: boolean;
  /** Present when the frontier review could not run — local findings still returned. */
  warning?: string;
}

/** What applying a set of findings actually changed. */
export interface EvermindKnowledgeRepair {
  /** Memories re-taught with corrected knowledge. */
  corrected: number;
  /** Memories dropped from the recall index — they can no longer be retrieved or
   *  ground a reply. NOT "unlearned": the residual influence a memory already had on
   *  the weights is superseded the normal write-through way, by teaching the
   *  correction, and for an `unusable`/`redundant` finding there IS no correction to
   *  teach. The strings below say this rather than claiming more than happened. */
  forgotten: number;
  /** Contributions merged by the closing flush. */
  merged: number;
  version: number;
  skipped: Array<{ id: number; reason: string }>;
}

/** What a clean-up pass removed. */
export interface EvermindCleanupResult {
  /** Queued-but-unmerged contributions dropped. */
  discarded: number;
  /** Cached question→answer pairs purged. */
  cachedAnswers: number;
}

/** What a recall reindex recomputed. */
export interface EvermindReindexResult {
  reindexed: number;
  skipped: number;
  version: number;
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
  /**
   * Teach from raw text (a transcript / exemplar); `prompt` is the task it answered.
   *
   * Resolving is ACCEPTANCE, never success: the contribution is queued and the frontier
   * teacher only runs later, in the coordinator's debounced merge. A host that can
   * return the server's contribution id should — that is what lets the console poll
   * {@link EvermindConsoleAdapter.teachStatus} and replace its optimistic toast with
   * what actually happened. Returning `void` keeps the old optimistic behaviour.
   */
  teach(text: string, prompt?: string): Promise<EvermindTeachResult | void>;
  /**
   * OPTIONAL — poll one contribution's outcome by the id {@link teach} returned. When a
   * host implements BOTH, the console resolves "Queued for learning" into the real
   * result: taught-and-distilled, taught-without-a-teacher, or a named teacher fault.
   * A host that omits it keeps the optimistic toast.
   */
  teachStatus?(contributionId: number): Promise<EvermindContributionStatus>;
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
  /**
   * OPTIONAL — TEST BENCH: generate from the model and grade the output. Pass a prompt
   * to see what the model produces for it; omit it to run the fixed readiness suite that
   * gates enabling inference. When present the console renders the test bench.
   */
  probe?(prompt?: string): Promise<EvermindProbeResult>;
  /**
   * OPTIONAL — REPLACE the model's weights with a fresh base (a published model by
   * `slug`, or a clean starter base when omitted), as a new version. The repair path for
   * a model that has trained itself into gibberish. Inference is left OFF afterwards.
   */
  reseed?(slug?: string): Promise<{ version: number }>;
  /** OPTIONAL — recompute every learned memory's recall embedding against the current
   *  model, so retrieval stops drifting as the model learns. */
  reindex?(): Promise<EvermindReindexResult>;
  /** OPTIONAL — drop queued-but-unmerged contributions and purge cached answers.
   *  Never touches what the model has already learned. */
  cleanup?(): Promise<EvermindCleanupResult>;
  /** OPTIONAL — audit what the model has learned (read-only) and report what is wrong. */
  analyze?(): Promise<EvermindKnowledgeAnalysis>;
  /** OPTIONAL — apply an audit's findings: forget bad knowledge, re-teach corrections. */
  applyFindings?(findings: EvermindKnowledgeFinding[]): Promise<EvermindKnowledgeRepair>;
  /**
   * OPTIONAL — write to the HOST's clipboard, for the diagnostics export. Tried before
   * `navigator.clipboard`, which a VS Code webview may not be permitted to use; a host
   * that omits it falls back to the browser API and then to manual selection.
   */
  copyText?(text: string): Promise<void>;
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
  /** INTERIM state: the contribution is queued. Resolved by the status poll below. */
  taught: string;
  /** Resolved: a frontier teacher answered and the model learned that answer. */
  taughtDistilled: (model: string, version: number) => string;
  /** Resolved: learned from the raw text with no teacher pinned — a legitimate mode. */
  taughtSelf: (version: number) => string;
  /** Resolved: it learned, but the PINNED teacher produced nothing. Actionable. */
  taughtTeacherFault: (model: string, reason: string) => string;
  /** Resolved: a merge consumed it and it never became a memory. */
  taughtDropped: string;
  /** The poll gave up while still queued — honest about not knowing yet, not a failure. */
  taughtStillPending: string;
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
  // Test bench (generate + grade — "what will this model actually produce?")
  testTitle: string;
  testHint: string;
  testPlaceholder: string;
  testRunCta: string;
  testReadinessCta: string;
  testRunning: string;
  /** Header over the results of a readiness run vs a single prompt run. */
  testResultReadiness: (passed: number, total: number) => string;
  testResultPrompt: string;
  testServable: string;
  testRefused: string;
  /** The plain-language reason an output was refused. */
  testRefusedBecause: (detail: string) => string;
  testEmptyOutput: string;
  testVerdictReady: string;
  testVerdictNotReady: string;
  // Maintenance (re-seed / reindex / clean up)
  maintenanceTitle: string;
  maintenanceHint: string;
  reseedLabel: string;
  reseedHint: string;
  reseedCta: string;
  reseedConfirm: string;
  reseedStarterOption: string;
  reseedDone: (version: number) => string;
  reindexLabel: string;
  reindexHint: string;
  reindexCta: string;
  reindexDone: (reindexed: number) => string;
  cleanupLabel: string;
  cleanupHint: string;
  cleanupCta: string;
  cleanupConfirm: string;
  cleanupDone: (discarded: number, cached: number) => string;
  // Knowledge analyzer (audit learned knowledge, then repair it)
  analyzeTitle: string;
  analyzeHint: string;
  analyzeCta: string;
  analyzing: string;
  analyzeClean: (analyzed: number) => string;
  analyzeSummary: (issues: number, analyzed: number, model: string) => string;
  analyzeSummaryLocal: (issues: number, analyzed: number) => string;
  analyzeVerdict: (verdict: EvermindKnowledgeVerdict) => string;
  analyzeCorrectionLabel: string;
  analyzeSelectAll: string;
  analyzeSelectNone: string;
  analyzeApplyCta: (count: number) => string;
  analyzeApplying: string;
  analyzeApplied: (corrected: number, forgotten: number, version: number) => string;
  /** Coverage line shown when the audit reviewed only part of the history. */
  analyzeCoverage: (analyzed: number, total: number) => string;
  analyzeSkipped: (count: number) => string;
  // Tabs — the console's four working surfaces (state stays outside the strip).
  tabsLabel: string;
  tabTeach: string;
  tabTest: string;
  tabCheck: string;
  tabMaintain: string;
  // Diagnostics export (the report BODY is deliberately unlocalized — see
  // diagnosticsReport.ts; only these controls are).
  diagnosticsTitle: string;
  diagnosticsHint: string;
  diagnosticsCta: string;
  diagnosticsCopied: string;
  diagnosticsShow: string;
  diagnosticsHide: string;
  diagnosticsManualHint: string;
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
  taughtDistilled: (m, v) => `Taught: ${m} answered it and the model learned that answer (v${v}).`,
  taughtSelf: (v) => `Taught: learned from your text, with no teacher model (v${v}).`,
  taughtTeacherFault: (m, reason) => `Learned, but the teacher ${m} produced nothing (${reason}) — so the model learned your raw text, not an ideal answer.`,
  taughtDropped: 'Not learned: the merge could not use this contribution.',
  taughtStillPending: 'Still queued — this will merge on the next learning pass.',
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
  testTitle: 'Test bench',
  testHint:
    'Run a prompt through the model and see exactly what it writes, graded the same way a real reply is. This is how you check the model is worth switching on — before anyone chats with it.',
  testPlaceholder: 'Ask the model something, e.g. “Summarise where this project stands.”',
  testRunCta: 'Run prompt',
  testReadinessCta: 'Readiness check',
  testRunning: 'Generating…',
  testResultReadiness: (passed, total) => `Readiness check — ${passed} of ${total} answers usable`,
  testResultPrompt: 'What the model produced',
  testServable: 'Usable',
  testRefused: 'Refused',
  testRefusedBecause: (detail) => `This would not be shown to a user: ${detail}.`,
  testEmptyOutput: '(the model produced nothing)',
  testVerdictReady: 'This model is coherent enough to serve replies.',
  testVerdictNotReady: 'This model is not coherent enough to serve replies yet. Teach it more, set a teacher model, or re-seed it below.',
  maintenanceTitle: 'Maintenance',
  maintenanceHint: 'Repair and tidy the model when it has gone wrong. None of this deletes your project’s work.',
  reseedLabel: 'Replace the model',
  reseedHint:
    'Start over from a known-good base, keeping the project. Use this when the model has trained itself into nonsense. Replies stay switched off until it passes a readiness check again.',
  reseedCta: 'Replace…',
  reseedConfirm: 'Replace this model’s brain with a fresh base? What it has learned so far will no longer shape its answers. This cannot be undone.',
  reseedStarterOption: 'Fresh starter base (untrained)',
  reseedDone: (version) => `Model replaced — now at v${version}. Run a readiness check before switching replies back on.`,
  reindexLabel: 'Rebuild recall index',
  reindexHint:
    'Re-file every memory against the current model. Memories are filed when they are learned, so recall drifts as the model changes — rebuild if it starts recalling the wrong things.',
  reindexCta: 'Rebuild index',
  reindexDone: (reindexed) => `Re-filed ${reindexed} memor${reindexed === 1 ? 'y' : 'ies'}.`,
  cleanupLabel: 'Clean up',
  cleanupHint:
    'Throw away anything queued but not yet learned, and clear cached answers so repeat questions are answered fresh. Learned knowledge is untouched.',
  cleanupCta: 'Clean up',
  cleanupConfirm: 'Discard everything queued but not yet learned, and clear cached answers?',
  cleanupDone: (discarded, cached) => `Discarded ${discarded} queued item(s) and cleared ${cached} cached answer(s).`,
  analyzeTitle: 'Check what it has learned',
  analyzeHint:
    'Read back everything the model has learned and have a frontier model check it for mistakes, stale facts and nonsense — then fix what is wrong by teaching the corrections.',
  analyzeCta: 'Check knowledge',
  analyzing: 'Checking…',
  analyzeClean: (analyzed) => `Checked ${analyzed} memor${analyzed === 1 ? 'y' : 'ies'} — nothing looks wrong.`,
  analyzeSummary: (issues, analyzed, model) => `${issues} of ${analyzed} memories need attention (checked by ${model}).`,
  analyzeSummaryLocal: (issues, analyzed) => `${issues} of ${analyzed} memories need attention.`,
  analyzeVerdict: (verdict) => ({
    ok: 'Fine',
    incoherent: 'Nonsense',
    incorrect: 'Wrong',
    outdated: 'Out of date',
    unusable: 'Not an answer',
    redundant: 'Duplicate',
  }[verdict] ?? verdict),
  analyzeCorrectionLabel: 'Will be replaced with',
  analyzeSelectAll: 'Select all',
  analyzeSelectNone: 'Clear selection',
  analyzeApplyCta: (count) => `Fix ${count} selected`,
  analyzeApplying: 'Fixing…',
  analyzeApplied: (corrected, forgotten, version) =>
    `${corrected} corrected and re-taught, ${forgotten} removed from recall (already-learned influence is superseded by the correction, not erased). Model is now at v${version}.`,
  analyzeCoverage: (analyzed, total) =>
    `Reviewed the ${analyzed} most recent of ${total} memories — run again to continue through the rest.`,
  analyzeSkipped: (count) => `${count} could not be applied.`,
  tabsLabel: 'Evermind controls',
  tabTeach: 'Teach',
  tabTest: 'Test',
  tabCheck: 'Check',
  tabMaintain: 'Maintain',
  diagnosticsTitle: 'Diagnostics',
  diagnosticsHint:
    'Copy everything on this panel — the model’s state, what it actually produced, what it has learned and any problems found — as text you can paste to support or to an AI assistant.',
  diagnosticsCta: 'Copy diagnostics',
  diagnosticsCopied: 'Copied to your clipboard.',
  diagnosticsShow: 'Show report',
  diagnosticsHide: 'Hide report',
  diagnosticsManualHint: 'Copying automatically was blocked here — the report is selected below, press Ctrl/Cmd+C to copy it.',
  refresh: 'Refresh',
  errorGeneric: 'Something went wrong. Try again.',
};
