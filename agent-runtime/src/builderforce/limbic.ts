/**
 * Limbic system — the dynamic affective/motivational layer (deterministic compiler).
 *
 * Where {@link compilePsychometricProfile} turns a *static* personality into
 * behaviour, this module turns a *dynamic* affective state into behaviour. The
 * two compose by design (the operator chose "personality = setpoints, limbic =
 * dynamics"):
 *
 *   • Personality (PsychometricProfile) → homeostatic *setpoints* + gains
 *     (the resting mood/drives an agent relaxes toward). See {@link deriveLimbicSetpoints}.
 *   • Limbic state (this run's valence / arousal / drives / attention /
 *     exploration) → the live *deviation* from those setpoints, updated each
 *     turn from experience by the brain regions below.
 *
 * Brain-region map (mirrors the labelled diagram):
 *   • Amygdala      → fast salience/threat appraisal of an event → affect delta
 *   • Hypothalamus  → homeostasis: relax drives toward setpoints; effort fatigue
 *   • Thalamus      → attention gate (inverted-U of arousal — Yerkes–Dodson)
 *   • Basal ganglia → action-selection bias (explore vs. exploit)
 *   • Hippocampus   → reused (the existing SSM memory) — supplies the experience
 *                     embedding the trainable LimbicModel learns from.
 *
 * This file is pure and deterministic (no GPU, no I/O) so it is unit-testable
 * and shared by both engines. The trainable WebGPU model lives in
 * `@seanhogg/builderforce-memory` (LimbicModel/LimbicSession); the
 * {@link LimbicSystemService} uses this compiler for the heuristic fast-path and
 * to generate the model's training targets, and the model to refine appraisal
 * from embeddings.
 *
 * Dimension ids and indices MUST stay in sync with the engine's
 * `limbic/regions.ts` ({@link LimbicDimName} / LIMBIC_DIM).
 */
import type { ThinkLevel, ReasoningLevel } from "../auto-reply/thinking.js";
import { DIM, type PsychometricExecParams, type PsychometricProfile } from "./psychometrics.js";

// ---------------------------------------------------------------------------
// Affective state model (kept in lockstep with engine limbic/regions.ts)
// ---------------------------------------------------------------------------

export type LimbicDimName =
  | "valence"
  | "arousal"
  | "driveCuriosity"
  | "driveCaution"
  | "driveEffort"
  | "driveSocial"
  | "attention"
  | "exploration";

export const LIMBIC_DIM_NAMES: LimbicDimName[] = [
  "valence",
  "arousal",
  "driveCuriosity",
  "driveCaution",
  "driveEffort",
  "driveSocial",
  "attention",
  "exploration",
];

export const LIMBIC_STATE_DIM = 8;

/** Inclusive bounds per dim; valence is signed, the rest are [0,1]. */
const BOUNDS: Record<LimbicDimName, [number, number]> = {
  valence: [-1, 1],
  arousal: [0, 1],
  driveCuriosity: [0, 1],
  driveCaution: [0, 1],
  driveEffort: [0, 1],
  driveSocial: [0, 1],
  attention: [0, 1],
  exploration: [0, 1],
};

/** Resting state before personality pulls it anywhere. */
export const NEUTRAL_STATE: Readonly<Record<LimbicDimName, number>> = {
  valence: 0.0,
  arousal: 0.2,
  driveCuriosity: 0.5,
  driveCaution: 0.5,
  driveEffort: 0.8,
  driveSocial: 0.5,
  attention: 0.7,
  // 0.5 keeps the resting state behaviourally inert (the exploration-driven
  // temperature term is centred here); the small effort/caution terms still
  // leave the resting *bias* mildly exploit-leaning.
  exploration: 0.5,
};

/** The live affective state — a labelled, bounded record. */
export type LimbicState = Record<LimbicDimName, number>;
/** Homeostatic setpoints — same shape; what the state relaxes toward. */
export type LimbicSetpoints = Record<LimbicDimName, number>;
/** A signed affect change (delta) applied to a state. */
export type LimbicDelta = Partial<Record<LimbicDimName, number>>;

export function clamp(name: LimbicDimName, v: number): number {
  const [lo, hi] = BOUNDS[name];
  if (Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/** A fresh neutral state. */
export function neutralState(): LimbicState {
  return { ...NEUTRAL_STATE };
}

/** Apply a delta to a state, clamped, returning a new state. */
export function applyDelta(state: LimbicState, delta: LimbicDelta): LimbicState {
  const out = { ...state };
  for (const name of LIMBIC_DIM_NAMES) {
    const d = delta[name];
    if (typeof d === "number" && !Number.isNaN(d)) out[name] = clamp(name, out[name] + d);
  }
  return out;
}

/** Dense Float32-friendly array view, index-aligned with the engine. */
export function stateToArray(state: LimbicState): number[] {
  return LIMBIC_DIM_NAMES.map((n) => state[n]);
}
export function arrayToState(arr: ArrayLike<number>): LimbicState {
  const out = neutralState();
  for (let i = 0; i < LIMBIC_DIM_NAMES.length; i++) {
    const v = arr[i];
    if (typeof v === "number" && !Number.isNaN(v)) out[LIMBIC_DIM_NAMES[i]!] = clamp(LIMBIC_DIM_NAMES[i]!, v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Personality → setpoints (the static layer sets where dynamics settle)
// ---------------------------------------------------------------------------

const HI = 65;
const LO = 35;
const NEUTRAL = 50;

function score(profile: PsychometricProfile | undefined, id: string): number {
  const raw = profile?.vector?.[id];
  if (typeof raw !== "number" || Number.isNaN(raw)) return NEUTRAL;
  return Math.max(0, Math.min(100, raw));
}

/** Map a 0..100 trait, centred at 50, to a signed [-1,1] influence. */
function infl(s: number): number {
  return (s - NEUTRAL) / NEUTRAL;
}

/**
 * Derive homeostatic setpoints from a personality profile. A high-Openness,
 * promotion-focused agent rests more curious and exploratory; a high-Emotionality,
 * prevention-focused, conscientious agent rests more cautious and aroused. Absent
 * personality → the neutral resting state.
 */
export function deriveLimbicSetpoints(profile: PsychometricProfile | undefined): LimbicSetpoints {
  const sp = neutralState();
  if (!profile) return sp;

  const open = infl(score(profile, DIM.openness));
  const emo = infl(score(profile, DIM.emotionality));
  const consc = infl(score(profile, DIM.conscientiousness));
  const extra = infl(score(profile, DIM.extraversion));
  const reg = infl(score(profile, DIM.regulatoryFocus)); // +promotion / -prevention
  const risk = infl(score(profile, DIM.riskTolerance));
  const grit = infl(score(profile, DIM.grit));
  const stim = infl(score(profile, DIM.valStimulation));

  sp.driveCuriosity = clamp("driveCuriosity", 0.5 + 0.35 * open + 0.15 * stim);
  sp.exploration = clamp("exploration", 0.4 + 0.3 * open + 0.25 * risk + 0.15 * reg);
  sp.driveCaution = clamp("driveCaution", 0.5 + 0.3 * consc - 0.3 * risk - 0.2 * reg + 0.15 * emo);
  sp.arousal = clamp("arousal", 0.2 + 0.2 * emo + 0.1 * extra);
  sp.driveSocial = clamp("driveSocial", 0.5 + 0.35 * extra);
  sp.driveEffort = clamp("driveEffort", 0.8 + 0.15 * grit + 0.1 * consc);
  // Valence/attention rest near neutral; personality nudges baseline mood slightly.
  sp.valence = clamp("valence", 0.0 + 0.1 * reg - 0.1 * emo);
  sp.attention = clamp("attention", 0.7 + 0.1 * consc);
  return sp;
}

// ---------------------------------------------------------------------------
// Amygdala — fast salience/threat appraisal of an event → affect delta
// ---------------------------------------------------------------------------

/** A discrete experience the agent encounters during a run. */
export interface LimbicEvent {
  kind: "success" | "progress" | "error" | "blocked" | "risk" | "feedback" | "idle";
  /** Strength of the event in [0,1]. Default 0.5. */
  intensity?: number;
  /** Signed valence for feedback events: + praise, - criticism. Default +1. */
  sign?: number;
  /** Free text (e.g. error message) — embedded by the service to drive the model. */
  text?: string;
}

const I = (e: LimbicEvent): number => Math.max(0, Math.min(1, e.intensity ?? 0.5));

/**
 * The amygdala's fast appraisal: an event → a bounded affect delta. This is the
 * heuristic teacher signal — the trainable model learns to reproduce and
 * generalise it from hippocampal embeddings.
 */
export function appraiseAmygdala(event: LimbicEvent): LimbicDelta {
  const k = I(event);
  switch (event.kind) {
    case "success":
      return { valence: +0.5 * k, arousal: -0.15 * k, driveCaution: -0.1 * k, driveEffort: -0.05 * k };
    case "progress":
      return { valence: +0.25 * k, arousal: +0.05 * k, driveEffort: -0.03 * k };
    case "error":
      return { valence: -0.45 * k, arousal: +0.4 * k, driveCaution: +0.3 * k, attention: +0.15 * k };
    case "blocked":
      return { valence: -0.35 * k, arousal: +0.3 * k, driveEffort: -0.15 * k, driveSocial: +0.2 * k };
    case "risk":
      return { arousal: +0.35 * k, driveCaution: +0.4 * k, attention: +0.2 * k, exploration: -0.15 * k };
    case "feedback": {
      const s = Math.sign(event.sign ?? 1) || 1;
      return { valence: 0.4 * k * s, arousal: 0.1 * k, driveSocial: +0.1 * k };
    }
    case "idle":
      return { arousal: -0.2 * k, driveEffort: +0.15 * k };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Hypothalamus — homeostasis: relax toward setpoints + effort fatigue
// ---------------------------------------------------------------------------

/**
 * One homeostatic tick: every dim relaxes a fraction `rate` toward its setpoint.
 * Effort additionally fatigues by `fatigue` (work costs energy) — recovery only
 * happens via setpoint relaxation or an `idle` appraisal.
 */
export function homeostasis(
  state: LimbicState,
  setpoints: LimbicSetpoints,
  opts: { rate?: number; fatigue?: number } = {},
): LimbicState {
  const rate = opts.rate ?? 0.1;
  const fatigue = opts.fatigue ?? 0.0;
  const out = { ...state };
  for (const name of LIMBIC_DIM_NAMES) {
    out[name] = clamp(name, out[name] + rate * (setpoints[name] - out[name]));
  }
  if (fatigue > 0) out.driveEffort = clamp("driveEffort", out.driveEffort - fatigue);
  return out;
}

// ---------------------------------------------------------------------------
// Thalamus — attention gate (inverted-U of arousal, Yerkes–Dodson)
// ---------------------------------------------------------------------------

/**
 * The thalamic gate: how much incoming signal is admitted, as a function of
 * arousal. Attention peaks at moderate arousal and degrades when calm
 * (under-engaged) or highly aroused (stressed/scattered). Returns [0,1].
 */
export function thalamusGate(state: LimbicState, optimalArousal = 0.5): number {
  const d = state.arousal - optimalArousal;
  // Parabola peaking at optimalArousal=1.0, falling to ~0.3 at the extremes.
  const gain = 1 - 2.8 * d * d;
  return Math.max(0.1, Math.min(1, gain));
}

// ---------------------------------------------------------------------------
// Basal ganglia — action selection (explore vs. exploit)
// ---------------------------------------------------------------------------

/** Probability-like bias toward exploration in [0,1]. */
export function basalGangliaExploreBias(state: LimbicState): number {
  // Curiosity and the exploration drive push toward novelty; low effort and
  // negative valence (and high caution) pull toward the safe, known option.
  let b = 0.5 * state.exploration + 0.3 * state.driveCuriosity;
  b += 0.15 * state.valence; // confident → more willing to explore
  b -= 0.25 * (1 - state.driveEffort); // tired → exploit
  b -= 0.2 * (state.driveCaution - 0.5); // cautious → exploit
  return Math.max(0, Math.min(1, b));
}

/**
 * Choose among candidate actions tagged with a `novelty` ∈ [0,1]. Picks the
 * action whose novelty best matches the current explore/exploit bias. Pure and
 * deterministic (no RNG) — ties resolve to the first.
 */
export function basalGangliaSelect<T extends { novelty: number }>(
  state: LimbicState,
  options: T[],
): { choice: T | null; exploreBias: number } {
  if (options.length === 0) return { choice: null, exploreBias: basalGangliaExploreBias(state) };
  const bias = basalGangliaExploreBias(state);
  let best = options[0]!;
  let bestScore = -Infinity;
  for (const o of options) {
    const nov = Math.max(0, Math.min(1, o.novelty));
    const sc = -Math.abs(nov - bias);
    if (sc > bestScore) {
      bestScore = sc;
      best = o;
    }
  }
  return { choice: best, exploreBias: bias };
}

// ---------------------------------------------------------------------------
// The compiler: limbic state -> { directives, params }
// ---------------------------------------------------------------------------

/**
 * Limbic execution levers. Unlike the psychometric (static) params, temperature
 * is expressed as a signed *delta* applied on top of the personality baseline —
 * the dynamic layer nudges the static one rather than overriding it.
 */
export type LimbicExecParams = {
  thinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  /** Signed temperature delta in roughly [-0.3, 0.3]. */
  temperatureDelta?: number;
};

export type CompiledLimbic = {
  directives: string[];
  params: LimbicExecParams;
};

const THINK_ORDER: ThinkLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
export function maxThink(a: ThinkLevel | undefined, b: ThinkLevel): ThinkLevel {
  if (!a) return b;
  return THINK_ORDER.indexOf(a) >= THINK_ORDER.indexOf(b) ? a : b;
}

const HI_F = 0.6; // high threshold for a [0,1] drive
const LO_F = 0.4;

/**
 * Compile the live affective state into behaviour: mood/drive directives plus
 * execution levers. Pure and deterministic. Returns empty directives/params for
 * a state at rest (close to neutral), so an un-aroused agent reads no different
 * from baseline.
 */
export function compileLimbicState(state: LimbicState): CompiledLimbic {
  const directives: string[] = [];
  const params: LimbicExecParams = {};

  // --- Valence (core affect) ---------------------------------------------
  if (state.valence <= -0.4) {
    directives.push(
      "Affect (negative): recent steps have gone badly — slow down, avoid rash or destructive actions, and re-verify your assumptions before proceeding.",
    );
    params.thinkLevel = maxThink(params.thinkLevel, "high");
    params.reasoningLevel = "on";
  } else if (state.valence >= 0.4) {
    directives.push("Affect (positive): things are going well — keep momentum, but don't get sloppy.");
  }

  // --- Arousal (core affect) ---------------------------------------------
  if (state.arousal >= 0.7) {
    directives.push(
      "Arousal (heightened): you are highly activated — resist the urge to rush; double-check before any irreversible step.",
    );
    params.thinkLevel = maxThink(params.thinkLevel, "high");
  } else if (state.arousal <= 0.15) {
    directives.push("Arousal (low): this is routine — keep it lightweight and efficient.");
  }

  // --- Hypothalamus drives -----------------------------------------------
  if (state.driveCaution >= HI_F) {
    directives.push(
      "Drive (caution): heightened — prefer reversible steps, add guardrails, and confirm risky or destructive operations.",
    );
    params.thinkLevel = maxThink(params.thinkLevel, "medium");
  } else if (state.driveCaution <= LO_F) {
    directives.push("Drive (caution): relaxed — bias to action on low-risk work.");
  }

  if (state.driveCuriosity >= HI_F) {
    directives.push("Drive (curiosity): high — it is appropriate to investigate and consider alternative approaches.");
  }

  if (state.driveEffort <= LO_F) {
    directives.push(
      "Drive (effort): energy is low — keep scope tight, avoid over-engineering, checkpoint progress, and consider escalating rather than grinding.",
    );
  }

  if (state.driveSocial >= HI_F) {
    directives.push("Drive (social): communicate proactively — surface progress and ask for input when blocked.");
  } else if (state.driveSocial <= LO_F) {
    directives.push("Drive (social): work heads-down — narrate only what matters.");
  }

  // --- Thalamus attention gate -------------------------------------------
  const attentionGain = thalamusGate(state);
  if (attentionGain <= 0.5) {
    directives.push(
      "Attention (degraded): your attention gate is low — re-read the task carefully and do not skip verification steps.",
    );
    params.thinkLevel = maxThink(params.thinkLevel, "medium");
  }

  // --- Basal ganglia explore/exploit -------------------------------------
  const explore = basalGangliaExploreBias(state);
  if (explore >= 0.7) {
    directives.push("Action selection: lean exploratory — try a novel approach before settling on the obvious one.");
  } else if (explore <= 0.3) {
    directives.push("Action selection: lean exploitative — use the proven, known approach and avoid unnecessary detours.");
  }

  // --- Temperature delta (sampling) --------------------------------------
  let dTemp = 0;
  dTemp += 0.2 * (state.exploration - 0.5) * 2; // explore → hotter
  dTemp += 0.06 * (state.driveCuriosity - 0.5) * 2;
  dTemp += 0.08 * state.valence; // positive mood → slightly freer
  dTemp -= 0.16 * (state.driveCaution - 0.5) * 2; // caution → cooler
  dTemp -= 0.08 * Math.max(0, state.arousal - 0.7); // very high arousal → tighten
  const clampedTemp = Math.max(-0.3, Math.min(0.3, Math.round(dTemp * 100) / 100));
  if (Math.abs(clampedTemp) >= 0.02) params.temperatureDelta = clampedTemp;

  return { directives, params };
}

/**
 * Compose the dynamic limbic params on top of the static psychometric params —
 * the "personality = setpoints, limbic = dynamics" contract. Think level takes
 * the deeper of the two (a floor); reasoning turns on if either asks; the limbic
 * temperature *delta* nudges the psychometric baseline (default 0.6 when the
 * personality set none). Returns absolute {@link PsychometricExecParams} so the
 * run path consumes it identically to the psychometric-only case.
 */
export function mergeLimbicWithPsychometric(
  psych: PsychometricExecParams,
  limbic: LimbicExecParams,
): PsychometricExecParams {
  const out: PsychometricExecParams = { ...psych };

  if (limbic.thinkLevel) out.thinkLevel = maxThink(psych.thinkLevel, limbic.thinkLevel);
  if (limbic.reasoningLevel === "on" || psych.reasoningLevel === "on") out.reasoningLevel = "on";

  if (typeof limbic.temperatureDelta === "number" && limbic.temperatureDelta !== 0) {
    const baseline = psych.temperature ?? 0.6;
    out.temperature = Math.round(Math.max(0.1, Math.min(1.0, baseline + limbic.temperatureDelta)) * 100) / 100;
  }
  return out;
}

/** Render the limbic directives as a system-prompt sub-block. '' when at rest. */
export function buildLimbicBlock(state: LimbicState | undefined): string {
  if (!state) return "";
  const { directives } = compileLimbicState(state);
  if (directives.length === 0) return "";
  return ["Current affective state (execute accordingly):", ...directives.map((d) => `- ${d}`)].join("\n");
}
