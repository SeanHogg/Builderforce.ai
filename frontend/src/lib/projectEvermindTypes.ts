/**
 * Project Evermind payload types — the shapes `/api/projects/:id/evermind/*` returns,
 * with no transport attached. Split from `projectEvermindApi.ts` so a pure reader of
 * these shapes (the brain-region derivation, which the Synapse desktop bundle compiles
 * too) does not drag the web API client into every program that type-checks it.
 *
 * The console's payloads are the `@seanhogg/builderforce-brain-ui` Evermind contract —
 * the SAME types the VS Code and Synapse hosts read — so they are aliased here, never
 * restated. Only what the web alone renders (the head, limbic affect, training
 * telemetry) is declared in this file.
 */
import type {
  EvermindCodingGateView,
  EvermindConsoleData,
  EvermindEvalPoint,
  EvermindMode,
  EvermindRecentEntry,
  EvermindTarget,
} from '@seanhogg/builderforce-brain-ui';

export type ProjectEvermindMode = EvermindMode;
/** The coding-quality gate (mirrors api `EvermindCodingGate`). */
export type ProjectEvermindCodingGate = EvermindCodingGateView;
/** One inspectable contribution the coordinator merged into a version. */
export type ProjectEvermindRecentEntry = EvermindRecentEntry;
/** The latest automatic regression check (mirrors api `ProjectEvermindEvalPoint`). */
export type ProjectEvermindEvalPoint = EvermindEvalPoint;
/** One Evermind a project targets (self or an IDE build under it). Mirrors api `targetsCore`. */
export type ProjectEvermindTarget = EvermindTarget;


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

/**
 * The Evermind inspection console payload: the console contract plus what only the web's
 * Knowledge Map renders (training telemetry, limbic affect). The server always sends
 * `eval` (null until a merge had held-out examples to score).
 */
export interface ProjectEvermindContributions extends EvermindConsoleData {
  /** Per-version training telemetry (newest first) — loss + weight movement, the real
   *  data behind each neocortex update. Empty for projects that predate this telemetry. */
  training: ProjectEvermindTrainingPoint[];
  eval: ProjectEvermindEvalPoint | null;
  /** Current affective (limbic) state — powers the brain-map's limbic regions. */
  affect: ProjectEvermindAffect;
}
