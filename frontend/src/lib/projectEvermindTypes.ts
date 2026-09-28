/**
 * Project Evermind payload types — the shapes `/api/projects/:id/evermind/*` returns,
 * with no transport attached. Split from `projectEvermindApi.ts` so a pure reader of
 * these shapes (the brain-region derivation, which the Synapse desktop bundle compiles
 * too) does not drag the web API client into every program that type-checks it.
 */

export type ProjectEvermindMode = 'connected' | 'offline-frozen';

/** Current head for a project's Evermind (mirrors the api `headCore` response). */
export interface ProjectEvermindHead {
  version: number;
  ref: string | null;
  mode: ProjectEvermindMode;
  name: string;
  contributions: number;
  inferenceEnabled: boolean;
  /** Pinned frontier-LLM teacher model id, or null for self-learning on raw run text. */
  teacherModel: string | null;
  /** ISO timestamp of the last merged contribution, or null if never learned. */
  lastLearnedAt: string | null;
  seeded: boolean;
  /** ISO timestamp the head was AUTO-QUARANTINED (inference force-disabled after a
   *  streak of incoherent replies), or null when healthy. */
  quarantinedAt?: string | null;
  /** Human-readable reason for the quarantine, shown to the operator. */
  quarantineReason?: string | null;
  /** Whether this head may serve IDE coding turns (the 90% coding-eval gate). */
  codingGate?: ProjectEvermindCodingGate | null;
}

/**
 * The Evermind coding-quality gate (mirrors api `EvermindCodingGate`): a head serves
 * IDE coding turns only when a coding eval recorded for THIS version scores ≥ `bar`
 * (0.9) of the frontier baseline. Operator decision 2026-09-12.
 */
export interface ProjectEvermindCodingGate {
  qualified: boolean;
  reason: 'qualified' | 'unseeded' | 'quarantined' | 'no_eval' | 'stale_eval' | 'below_bar';
  bar: number;
  ratio: number | null;
  headVersion: number;
  evaluatedVersion: number | null;
  baselineModel?: string | null;
  dataset?: string | null;
}

/** One inspectable contribution the coordinator merged into a version. */
export interface ProjectEvermindRecentEntry {
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
  /** True when this contribution's weights were fitted into the merge — i.e. it moved
   *  the neocortex, which is what earns it a place in the Knowledge Map's Neocortex
   *  region. Absent on ring rows written before the flag existed (all of which were
   *  fitted), so read it as `fitted !== false` — never `fitted === true`. */
  fitted?: boolean;
  /** Readable snippet of the task prompt (text-path only). */
  prompt?: string;
  /** Readable snippet of the run/exemplar text learned (text-path only). Absent when a
   *  pinned teacher failed on a teach-a-task — see `skipReason`. */
  text?: string;
  /** True when a frontier teacher shaped what was learned (text-path only). */
  distilled?: boolean;
  /** The frontier model that distilled this entry (present when `distilled`). */
  teacherModel?: string;
  /** Why distillation did NOT happen — an `EvermindTeacherSkipReason`. */
  skipReason?: string;
  /** Operator-facing detail behind `skipReason` (HTTP status, exception message). */
  skipDetail?: string;
  /** The pinned teacher model that failed (present on a distillation fault). */
  attemptedTeacherModel?: string;
}

/** The 8 affective (limbic) state dimensions the runtime models. Mirrors
 *  `@builderforce/agent-tools` `LimbicDimName` — keep in sync. */
export type LimbicDimName =
  | 'valence' | 'arousal'
  | 'driveCuriosity' | 'driveCaution' | 'driveEffort' | 'driveSocial'
  | 'attention' | 'exploration';

/** The project Evermind's current affective (limbic) state — computed server-side by
 *  the shared limbic compiler from the model's setpoints + recent activity. */
export interface ProjectEvermindAffect {
  /** Current 8-dim affective state, grounded in recent learning activity. */
  state: Record<LimbicDimName, number>;
  /** Resting setpoints the dynamics relax toward (the personality layer). */
  setpoints: Record<LimbicDimName, number>;
  /** Thalamus attention gain (Yerkes–Dodson gate on current arousal). */
  attentionGain: number;
  /** Basal-ganglia explore-vs-exploit bias derived from the current state. */
  exploreBias: number;
}

/** One measured training run behind a version bump (mirrors api `ProjectEvermindTrainingPoint`).
 *  The real neocortex-update signal the Knowledge Map surfaces — nothing fabricated. */
export interface ProjectEvermindTrainingPoint {
  /** The version this training run produced. */
  version: number;
  /** Epoch ms the merge landed. */
  at: number;
  /** Mean next-token training loss across the adaptations folded into this version
   *  (0 when the merge was pure pre-diffed deltas, so no local fit measured a loss). */
  loss: number;
  /** Training sequences (token windows) fed to the trainer this merge. */
  seqs: number;
  /** Distinct neocortex weights the merge changed. */
  moved: number;
  /** L2 norm of the weight movement base→merged — magnitude of the update. */
  deltaNorm: number;
  /** Contributions folded into this version. */
  merged: number;
}

/** The latest automatic regression check (mirrors api `ProjectEvermindEvalPoint`): the
 *  previous vs merged model scored on the same held-out set of prior taught examples. */
export interface ProjectEvermindEvalPoint {
  version: number;
  at: number;
  /** Mean held-out loss of the previous version's model. */
  baseLoss: number;
  /** Mean held-out loss of the merged (new) version's model. */
  newLoss: number;
  /** baseLoss - newLoss (positive = improved / retained, negative = regressed). */
  delta: number;
  /** How many held-out examples were scored. */
  evalSize: number;
}

/** The Evermind inspection console payload — head summary + live learning activity. */
export interface ProjectEvermindContributions {
  version: number;
  seeded: boolean;
  mode: ProjectEvermindMode;
  contributions: number;
  inferenceEnabled: boolean;
  teacherModel: string | null;
  lastLearnedAt: string | null;
  /** Contributions queued but not yet merged (in the coordinator's debounce window). */
  pending: number;
  recent: ProjectEvermindRecentEntry[];
  /** Per-version training telemetry (newest first) — loss + weight movement, the real
   *  data behind each neocortex update. Empty for projects that predate this telemetry. */
  training: ProjectEvermindTrainingPoint[];
  /** Latest automatic pre/post regression check (▲/▼ vs the previous version), or null
   *  until a merge had a held-out set of prior taught examples to score. */
  eval: ProjectEvermindEvalPoint | null;
  /** Current affective (limbic) state — powers the brain-map's limbic regions. */
  affect: ProjectEvermindAffect;
  /**
   * True when this payload describes the PARENT container project's Evermind rather
   * than one belonging to the requested project. Non-`evermind` IDE builds (video,
   * voice, designer, finetune) deliberately have no Evermind of their own and inherit
   * their container's; the console renders read-only in that case, because reads
   * inherit but writes keep exact-id semantics.
   */
  inherited?: boolean;
  /** The container project whose Evermind is shown (present when `inherited`). */
  inheritedFromProjectId?: number;
  /** ISO timestamp this head auto-quarantined after a streak of incoherent serves
   *  (null when healthy) — drives the console's quarantine badge + reason. */
  quarantinedAt?: string | null;
  /** The probe-failure reason behind `quarantinedAt` (null when healthy). */
  quarantineReason?: string | null;
  /** The coding-quality gate's verdict — "coding eval X% of baseline, needs 90%". */
  codingGate?: ProjectEvermindCodingGate | null;
}

/** One Evermind a project targets (self or an IDE build under it). Mirrors api `targetsCore`. */
export interface ProjectEvermindTarget {
  projectId: number;
  ref: string | null;
  version: number;
  name: string;
  mode: ProjectEvermindMode;
  inferenceEnabled: boolean;
  seeded: boolean;
}
