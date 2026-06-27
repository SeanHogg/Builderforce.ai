/**
 * Limbic system — the dynamic affective/motivational layer (deterministic compiler).
 *
 * **This is the single, shared, dependency-free source** for the limbic
 * compiler, consumed by every agent surface so they all run the same affective
 * brain:
 *   • on-prem agent-runtime (embedded runner + Claude-Agent-SDK engine),
 *   • the cloud V3 engine (`api`), and
 *   • the VS Code extension's built-in agent.
 *
 * Where the psychometric personality is *static* (a trait vector → behaviour),
 * the limbic layer is *dynamic* (a live affective state → behaviour). They
 * compose: **personality = homeostatic setpoints, limbic = the live deviation**
 * the brain regions push around those setpoints in response to experience.
 *
 * Brain-region map (mirrors the labelled diagram):
 *   • Amygdala      → fast salience/threat appraisal of an event → affect delta
 *   • Hypothalamus  → homeostasis: relax drives toward setpoints; effort fatigue
 *   • Thalamus      → attention gate (inverted-U of arousal — Yerkes–Dodson)
 *   • Basal ganglia → action-selection bias (explore vs. exploit)
 *   • Hippocampus   → reused (the existing SSM memory) — supplies the experience
 *                     embedding the trainable LimbicModel learns from.
 *
 * Pure and deterministic (no GPU, no I/O) so it is unit-testable and runs in a
 * Cloudflare Worker, Node, and a VS Code extension alike. The trainable WebGPU
 * model lives in `@seanhogg/builderforce-memory`; this compiler is its
 * heuristic teacher and the always-available fallback.
 *
 * The only cross-system contract is the psychometric *dimension-id strings*
 * ({@link PSYCH_DIM}) — the single shared map, also consumed by `agent-runtime`
 * psychometrics `DIM` and the `api` psychometricCatalog `DIM`.
 */

// The setpoint derivation reads dimension ids from the single shared PSYCH_DIM map.
import { PSYCH_DIM } from "./psychometric-dims.js";

// ── Minimal shared types (kept structurally identical to the runtime's) ─────────

/** Reasoning depth ladder — identical union to agent-runtime's ThinkLevel. */
export type LimbicThinkLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
/** Mirrors agent-runtime's ReasoningLevel (incl. "stream") for structural compat. */
export type LimbicReasoningLevel = "on" | "off" | "stream";

/** Structural mirror of the runtime's PsychometricExecParams (no import cycle). */
export interface LimbicPsychExecParams {
  thinkLevel?: LimbicThinkLevel;
  reasoningLevel?: LimbicReasoningLevel;
  temperature?: number;
}

/** Structural mirror of the runtime's PsychometricProfile (vector + optional skins). */
export interface LimbicPsychProfile {
  vector?: Record<string, number>;
  enneagramType?: number;
  mbti?: string;
}


// ── Affective state model ───────────────────────────────────────────────────────

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

export type LimbicState = Record<LimbicDimName, number>;
export type LimbicSetpoints = Record<LimbicDimName, number>;
export type LimbicDelta = Partial<Record<LimbicDimName, number>>;

export function clamp(name: LimbicDimName, v: number): number {
  const [lo, hi] = BOUNDS[name];
  if (Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

export function neutralState(): LimbicState {
  return { ...NEUTRAL_STATE };
}

export function applyDelta(state: LimbicState, delta: LimbicDelta): LimbicState {
  const out = { ...state };
  for (const name of LIMBIC_DIM_NAMES) {
    const d = delta[name];
    if (typeof d === "number" && !Number.isNaN(d)) out[name] = clamp(name, out[name] + d);
  }
  return out;
}

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

// ── Personality → setpoints (the static layer sets where dynamics settle) ───────

const HI = 65;
const LO = 35;
const NEUTRAL = 50;

function score(profile: LimbicPsychProfile | undefined, id: string): number {
  const raw = profile?.vector?.[id];
  if (typeof raw !== "number" || Number.isNaN(raw)) return NEUTRAL;
  return Math.max(0, Math.min(100, raw));
}

function infl(s: number): number {
  return (s - NEUTRAL) / NEUTRAL;
}

export function deriveLimbicSetpoints(profile: LimbicPsychProfile | undefined): LimbicSetpoints {
  const sp = neutralState();
  if (!profile) return sp;

  const open = infl(score(profile, PSYCH_DIM.openness));
  const emo = infl(score(profile, PSYCH_DIM.emotionality));
  const consc = infl(score(profile, PSYCH_DIM.conscientiousness));
  const extra = infl(score(profile, PSYCH_DIM.extraversion));
  const reg = infl(score(profile, PSYCH_DIM.regulatoryFocus));
  const risk = infl(score(profile, PSYCH_DIM.riskTolerance));
  const grit = infl(score(profile, PSYCH_DIM.grit));
  const stim = infl(score(profile, PSYCH_DIM.valStimulation));

  sp.driveCuriosity = clamp("driveCuriosity", 0.5 + 0.35 * open + 0.15 * stim);
  sp.exploration = clamp("exploration", 0.4 + 0.3 * open + 0.25 * risk + 0.15 * reg);
  sp.driveCaution = clamp("driveCaution", 0.5 + 0.3 * consc - 0.3 * risk - 0.2 * reg + 0.15 * emo);
  sp.arousal = clamp("arousal", 0.2 + 0.2 * emo + 0.1 * extra);
  sp.driveSocial = clamp("driveSocial", 0.5 + 0.35 * extra);
  sp.driveEffort = clamp("driveEffort", 0.8 + 0.15 * grit + 0.1 * consc);
  sp.valence = clamp("valence", 0.0 + 0.1 * reg - 0.1 * emo);
  sp.attention = clamp("attention", 0.7 + 0.1 * consc);
  return sp;
}

// ── Amygdala — fast salience/threat appraisal of an event → affect delta ─────────

export interface LimbicEvent {
  kind: "success" | "progress" | "error" | "blocked" | "risk" | "feedback" | "idle";
  intensity?: number;
  sign?: number;
  text?: string;
}

const I = (e: LimbicEvent): number => Math.max(0, Math.min(1, e.intensity ?? 0.5));

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

// ── Hypothalamus — homeostasis: relax toward setpoints + effort fatigue ──────────

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

// ── Thalamus — attention gate (inverted-U of arousal, Yerkes–Dodson) ─────────────

export function thalamusGate(state: LimbicState, optimalArousal = 0.5): number {
  const d = state.arousal - optimalArousal;
  const gain = 1 - 2.8 * d * d;
  return Math.max(0.1, Math.min(1, gain));
}

// ── Basal ganglia — action selection (explore vs. exploit) ───────────────────────

export function basalGangliaExploreBias(state: LimbicState): number {
  let b = 0.5 * state.exploration + 0.3 * state.driveCuriosity;
  b += 0.15 * state.valence;
  b -= 0.25 * (1 - state.driveEffort);
  b -= 0.2 * (state.driveCaution - 0.5);
  return Math.max(0, Math.min(1, b));
}

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

// ── The compiler: limbic state -> { directives, params } ─────────────────────────

export type LimbicExecParams = {
  thinkLevel?: LimbicThinkLevel;
  reasoningLevel?: LimbicReasoningLevel;
  /** Signed temperature delta in roughly [-0.3, 0.3]. */
  temperatureDelta?: number;
};

export type CompiledLimbic = {
  directives: string[];
  params: LimbicExecParams;
};

const THINK_ORDER: LimbicThinkLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
export function maxThink(a: LimbicThinkLevel | undefined, b: LimbicThinkLevel): LimbicThinkLevel {
  if (!a) return b;
  return THINK_ORDER.indexOf(a) >= THINK_ORDER.indexOf(b) ? a : b;
}

const HI_F = 0.6;
const LO_F = 0.4;

export function compileLimbicState(state: LimbicState): CompiledLimbic {
  const directives: string[] = [];
  const params: LimbicExecParams = {};

  if (state.valence <= -0.4) {
    directives.push(
      "Affect (negative): recent steps have gone badly — slow down, avoid rash or destructive actions, and re-verify your assumptions before proceeding.",
    );
    params.thinkLevel = maxThink(params.thinkLevel, "high");
    params.reasoningLevel = "on";
  } else if (state.valence >= 0.4) {
    directives.push("Affect (positive): things are going well — keep momentum, but don't get sloppy.");
  }

  if (state.arousal >= 0.7) {
    directives.push(
      "Arousal (heightened): you are highly activated — resist the urge to rush; double-check before any irreversible step.",
    );
    params.thinkLevel = maxThink(params.thinkLevel, "high");
  } else if (state.arousal <= 0.15) {
    directives.push("Arousal (low): this is routine — keep it lightweight and efficient.");
  }

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

  const attentionGain = thalamusGate(state);
  if (attentionGain <= 0.5) {
    directives.push(
      "Attention (degraded): your attention gate is low — re-read the task carefully and do not skip verification steps.",
    );
    params.thinkLevel = maxThink(params.thinkLevel, "medium");
  }

  const explore = basalGangliaExploreBias(state);
  if (explore >= 0.7) {
    directives.push("Action selection: lean exploratory — try a novel approach before settling on the obvious one.");
  } else if (explore <= 0.3) {
    directives.push("Action selection: lean exploitative — use the proven, known approach and avoid unnecessary detours.");
  }

  let dTemp = 0;
  dTemp += 0.2 * (state.exploration - 0.5) * 2;
  dTemp += 0.06 * (state.driveCuriosity - 0.5) * 2;
  dTemp += 0.08 * state.valence;
  dTemp -= 0.16 * (state.driveCaution - 0.5) * 2;
  dTemp -= 0.08 * Math.max(0, state.arousal - 0.7);
  const clampedTemp = Math.max(-0.3, Math.min(0.3, Math.round(dTemp * 100) / 100));
  if (Math.abs(clampedTemp) >= 0.02) params.temperatureDelta = clampedTemp;

  return { directives, params };
}

/**
 * Compose the dynamic limbic params on top of the static psychometric params —
 * the "personality = setpoints, limbic = dynamics" contract. Think level takes
 * the deeper of the two (a floor); reasoning turns on if either asks; the limbic
 * temperature *delta* nudges the psychometric baseline (default 0.6 when none).
 */
export function mergeLimbicWithPsychometric(
  psych: LimbicPsychExecParams,
  limbic: LimbicExecParams,
): LimbicPsychExecParams {
  const out: LimbicPsychExecParams = { ...psych };
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

// ── Task appraisal — derive an initial affect from a task description ─────────────
// Used by surfaces that have no live event stream yet (cloud V3, VS Code): a quick
// amygdala read of the task text so the agent starts in a fitting affective state.

const RISK_PATTERNS =
  /\b(delete|drop|truncate|destroy|wipe|prod(uction)?|migrat|secret|credential|password|payment|billing|charge|refund|deploy|force[- ]?push|rm\s+-rf|irreversible|security|auth|breaking)\b/i;
const HARD_PATTERNS = /\b(refactor|rewrite|architecture|complex|large|entire|whole|across|end[- ]to[- ]end|overhaul)\b/i;

/**
 * Appraise a task's text into an initial affective deviation from `base`
 * (defaults to neutral): risky/destructive work raises caution + arousal;
 * large/complex work raises effort engagement + curiosity. Deterministic.
 */
export function appraiseTask(text: string, base: LimbicState = neutralState()): LimbicState {
  const t = text || "";
  const risky = RISK_PATTERNS.test(t);
  const hard = HARD_PATTERNS.test(t);
  let s = base;
  if (risky) {
    s = applyDelta(s, { driveCaution: +0.3, arousal: +0.25, attention: +0.15, exploration: -0.1 });
  }
  if (hard) {
    s = applyDelta(s, { driveCuriosity: +0.2, arousal: +0.1, exploration: +0.1 });
  }
  return s;
}
